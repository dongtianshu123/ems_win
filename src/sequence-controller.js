class SequenceController {
  constructor({ initialState = "STOPPED", initialPowerKw = 0 } = {}) {
    this.state = initialState;
    this.currentPowerKw = initialPowerKw;
    this.lockReason = null;
  }

  reject(reason) {
    return { accepted: false, state: this.state, reason };
  }

  start(signals = {}) {
    if (this.state !== "STOPPED") return this.reject("state_interlock");
    if (!signals.communicationGood) return this.reject("communication_interlock");
    if (!signals.faultsClear) return this.reject("fault_not_cleared");
    this.state = "STARTING_PUMPS";
    return { accepted: true, state: this.state, actions: ["START_PUMPS"] };
  }

  update(signals = {}) {
    let actions = [];
    if (this.state === "STARTING_PUMPS" && signals.pumpsRunning) this.state = "WAITING_FLOW";
    else if (this.state === "WAITING_FLOW" && signals.flowReady) {
      this.state = "PCS_READY";
      actions = ["START_PCS"];
    } else if (this.state === "PCS_READY" && signals.pcsRunning) this.state = "RUNNING";
    else if (this.state === "STOPPING_PCS" && signals.pcsStopped) {
      this.state = "STOPPING_PUMPS";
      actions = ["STOP_PUMPS"];
    } else if (this.state === "STOPPING_PUMPS" && signals.pumpsStopped) this.state = "STOPPED";
    else if (this.state === "RECOVERY_CHECKS" && signals.pcsStopped && signals.pumpsStopped && signals.faultsClear && signals.communicationGood) {
      this.state = "STOPPED";
      actions = ["RECOVERY_COMPLETE"];
    }
    return { state: this.state, actions };
  }

  requestPower(targetPowerKw, signals = {}) {
    if (this.state !== "RUNNING") return this.reject("state_interlock");
    if (!signals.communicationGood) return this.reject("communication_interlock");
    if (!Number.isFinite(targetPowerKw)) return this.reject("invalid_power_target");
    if (Math.abs(targetPowerKw) > Math.abs(this.currentPowerKw) && !signals.flowReady) return this.reject("flow_not_ready");
    this.currentPowerKw = targetPowerKw;
    return { accepted: true, state: this.state, actions: [{ type: "SET_POWER", value: targetPowerKw }] };
  }

  stop() {
    if (this.state !== "RUNNING" && this.state !== "PCS_READY") return this.reject("state_interlock");
    this.currentPowerKw = 0;
    this.state = "STOPPING_PCS";
    return { accepted: true, state: this.state, actions: ["SET_POWER_ZERO", "STOP_PCS"] };
  }

  emergencyStop(reason) {
    this.currentPowerKw = 0;
    this.state = "EMERGENCY_LOCKED";
    this.lockReason = reason || "emergency_stop";
    return { accepted: true, state: this.state, actions: ["EMERGENCY_STOP"], reason: this.lockReason };
  }

  reset({ operator, faultsClear, communicationGood } = {}) {
    if (this.state !== "EMERGENCY_LOCKED" && this.state !== "FAULT_LOCKED") return this.reject("state_interlock");
    if (typeof operator !== "string" || !operator.trim()) return this.reject("manual_reset_required");
    if (!faultsClear) return this.reject("fault_not_cleared");
    if (!communicationGood) return this.reject("communication_interlock");
    this.state = "RECOVERY_CHECKS";
    this.lockReason = null;
    return { accepted: true, state: this.state, actions: ["VERIFY_SAFE_STATE"] };
  }
}

module.exports = { SequenceController };
