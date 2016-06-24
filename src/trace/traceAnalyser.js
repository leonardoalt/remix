'use strict'
var traceHelper = require('../helpers/traceHelper')

function TraceAnalyser (_cache) {
  this.traceCache = _cache
  this.trace = null
}

TraceAnalyser.prototype.analyse = function (trace, tx, callback) {
  this.trace = trace
  this.traceCache.pushStoreChanges(0, tx.to)
  var context = {
    currentStorageAddress: tx.to,
    previousStorageAddress: tx.to
  }
  var callStack = [tx.to]
  this.traceCache.pushCallStack(0, {
    callStack: callStack.slice(0)
  })

  if (traceHelper.isContractCreation(tx.to)) {
    this.traceCache.pushContractCreation(tx.to, tx.input)
  }
  this.buildCalldata(0, this.trace[0], tx, true)

  for (var k = 0; k < this.trace.length; k++) {
    var step = this.trace[k]
    this.buildMemory(k, step)
    this.buildDepth(k, step, tx, callStack)
    context = this.buildStorage(k, step, context)
  }
  callback(null, true)
}

TraceAnalyser.prototype.buildCalldata = function (index, step, tx, newContext) {
  var calldata = ''
  if (index === 0) {
    calldata = tx.input
    this.traceCache.pushCallDataChanges(index, calldata)
  } else if (!newContext) {
    var lastCall = this.traceCache.callsData[this.traceCache.callDataChanges[this.traceCache.callDataChanges.length - 2]]
    this.traceCache.pushCallDataChanges(index + 1, lastCall)
  } else {
    var memory = this.trace[this.traceCache.memoryChanges[this.traceCache.memoryChanges.length - 1]].memory
    var callStep = this.trace[index]
    var stack = callStep.stack
    var offset = ''
    var size = ''
    if (callStep.op === 'DELEGATECALL') {
      offset = 2 * parseInt(stack[stack.length - 3], 16)
      size = 2 * parseInt(stack[stack.length - 4], 16)
    } else {
      offset = 2 * parseInt(stack[stack.length - 4], 16)
      size = 2 * parseInt(stack[stack.length - 5], 16)
    }
    calldata = '0x' + memory.join('').substr(offset, size)
    this.traceCache.pushCallDataChanges(index + 1, calldata)
  }
}

TraceAnalyser.prototype.buildMemory = function (index, step) {
  if (step.memory) {
    this.traceCache.pushMemoryChanges(index)
  }
}

TraceAnalyser.prototype.buildStorage = function (index, step, context) {
  if (traceHelper.newContextStorage(step)) {
    var calledAddress = traceHelper.resolveCalledAddress(index, this.trace)
    if (calledAddress) {
      context.currentStorageAddress = calledAddress
    } else {
      console.log('unable to build storage changes. ' + index + ' does not match with a CALL. storage changes will be corrupted')
    }
    this.traceCache.pushStoreChanges(index + 1, context.currentStorageAddress)
  } else if (traceHelper.isSSTOREInstruction(step)) {
    this.traceCache.pushStoreChanges(index + 1, context.currentStorageAddress, step.stack[step.stack.length - 1], step.stack[step.stack.length - 2])
  } else if (traceHelper.isReturnInstruction(step)) {
    context.currentStorageAddress = context.previousStorageAddress
    this.traceCache.pushStoreChanges(index + 1, context.currentStorageAddress)
  }
  return context
}

TraceAnalyser.prototype.buildDepth = function (index, step, tx, callStack) {
  if (traceHelper.isCallInstruction(step) && !traceHelper.isCallToPrecompiledContract(index, this.trace)) {
    if (traceHelper.isCreateInstruction(step)) {
      var contractToken = traceHelper.contractCreationToken(index)
      callStack.push(contractToken)
      var lastMemoryChange = this.traceCache.memoryChanges[this.traceCache.memoryChanges.length - 1]
      this.traceCache.pushContractCreationFromMemory(index, contractToken, this.trace, lastMemoryChange)
    } else {
      var newAddress = traceHelper.resolveCalledAddress(index, this.trace)
      if (newAddress) {
        callStack.push(newAddress)
      } else {
        console.log('unable to build depth changes. ' + index + ' does not match with a CALL. depth changes will be corrupted')
      }
    }
    this.traceCache.pushCallChanges(step, index + 1)
    this.traceCache.pushCallStack(index + 1, {
      callStack: callStack.slice(0)
    })
    this.buildCalldata(index, step, tx, true)
  } else if (traceHelper.isReturnInstruction(step)) {
    if (index + 1 < this.trace.length) {
      callStack.pop()
      this.traceCache.pushCallChanges(step, index + 1)
      this.traceCache.pushCallStack(index + 1, {
        callStack: callStack.slice(0)
      })
      this.buildCalldata(index, step, tx, false)
    }
  }
}

module.exports = TraceAnalyser
