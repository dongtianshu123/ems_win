const crypto = require("node:crypto");
const { getPointByAddress } = require("./point-model");

const POLICIES = new Map([
  [90, { min: 0, max: 1, states: ["STANDBY", "READY", "RUNNING"] }],
  [91, { min: 1, max: 1, states: ["STANDBY", "FAULT"] }],
  [92, { min: 1, max: 1, states: ["ANY"] }],
  [200, { min: 1, max: 1, states: ["STANDBY", "FAULT"] }],
  [201, { min: 0, max: 1, states: ["STANDBY", "READY"], stopInAnyState: true }],
  [204, { min: 0, max: 7, states: ["STANDBY", "READY"] }],
  [205, { min: 45, max: 55, states: ["STANDBY", "READY"] }],
  [206, { min: 0, max: 1000, states: ["STANDBY", "READY"] }],
  [207, { min: -2000, max: 2000, states: ["STANDBY", "READY", "RUNNING"] }],
  [208, { min: 0, max: 3600, states: ["STANDBY", "READY"] }],
  [209, { min: 0, max: 3600, states: ["STANDBY", "READY"] }],
  [210, { min: 0, max: 5000, states: ["STANDBY", "READY"] }],
  [211, { min: -1000, max: 1000, states: ["RUNNING"] }],
  [212, { min: -1000, max: 1000, states: ["RUNNING"] }],
  [213, { min: -1000, max: 1000, states: ["RUNNING"] }],
]);

function safeTokenEqual(expected, provided) {
  if (!expected || !provided) return false;
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(provided));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

class CommandEngine {
  constructor({ pointModel, enabled, token, now, stateProvider, interlockProvider, authority, writer, audit }) {
    this.pointModel = pointModel;
    this.enabled = enabled;
    this.token = token;
    this.now = now || Date.now;
    this.stateProvider = stateProvider;
    this.interlockProvider = interlockProvider;
    this.authority = authority;
    this.writer = writer;
    this.audit = audit || (() => {});
    this.commandIds = new Set();
  }

  reject(command, reason) {
    const ack = {
      type: "command_ack",
      commandId: command && command.id,
      status: "REJECTED",
      reason,
    };
    this.audit({ ...ack, timestamp: new Date(this.now()).toISOString() });
    return ack;
  }

  async execute(command, providedToken) {
    if (!this.enabled) return this.reject(command, "control_disabled");
    if (!safeTokenEqual(this.token, providedToken)) return this.reject(command, "unauthorized");
    if (!command || typeof command.id !== "string" || !command.id) {
      return this.reject(command, "invalid_command");
    }
    const issuedAt = Date.parse(command.issuedAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(command.ttlMs) || command.ttlMs <= 0) {
      return this.reject(command, "invalid_command");
    }
    if (issuedAt + command.ttlMs < this.now()) return this.reject(command, "expired");
    if (this.commandIds.has(command.id)) return this.reject(command, "duplicate_command");
    if (this.authority && !this.authority.canExecute(command.source, command.authorityOwner)) {
      return this.reject(command, "control_authority_denied");
    }

    let point;
    try {
      point = getPointByAddress(this.pointModel, command.pointAddress);
    } catch {
      return this.reject(command, "point_not_writable");
    }
    if (point.access !== "write") return this.reject(command, "point_not_writable");

    const policy = POLICIES.get(point.address);
    if (!policy) return this.reject(command, "command_not_allowed");
    if (!Number.isFinite(command.value) || command.value < policy.min || command.value > policy.max) {
      return this.reject(command, "value_out_of_range");
    }
    const state = this.stateProvider();
    const stopAllowed = policy.stopInAnyState && command.value === 0;
    if (!stopAllowed && !policy.states.includes("ANY") && !policy.states.includes(state)) {
      return this.reject(command, "state_interlock");
    }
    if (!Number.isInteger(command.unitId) || command.unitId < 1 || command.unitId > 247) {
      return this.reject(command, "invalid_unit_id");
    }

    let interlocks = null;
    if (this.interlockProvider) {
      try { interlocks = this.interlockProvider(command) || {}; }
      catch { return this.reject(command, "interlock_unavailable"); }
      if (!interlocks.communicationGood) return this.reject(command, "communication_interlock");
      const currentPower = interlocks.currentPowerKw;
      const increasingPower = point.address === 211 && (
        Number.isFinite(currentPower) ? Math.abs(command.value) > Math.abs(currentPower) : command.value !== 0
      );
      const startingPcs = point.address === 201 && command.value === 1;
      if ((increasingPower || startingPcs) && !interlocks.flowReady) return this.reject(command, "flow_not_ready");
    }

    this.commandIds.add(command.id);
    const request = {
      unitId: command.unitId,
      address: point.address,
      protocolOffset: point.protocolOffset,
      value: command.value,
    };
    try {
      const result = await this.writer(request);
      const ack = {
        type: "command_ack",
        commandId: command.id,
        status: "EXECUTED",
        transactionId: result && result.transactionId,
      };
      this.audit({ ...ack, request, timestamp: new Date(this.now()).toISOString() });
      return ack;
    } catch (error) {
      const ack = {
        type: "command_ack",
        commandId: command.id,
        status: "FAILED",
        reason: error instanceof Error ? error.message : String(error),
      };
      this.audit({ ...ack, request, timestamp: new Date(this.now()).toISOString() });
      return ack;
    }
  }
}

module.exports = { CommandEngine };
