class AlarmEngine {
  constructor({ debounceCount = 2, now = () => new Date().toISOString() } = {}) {
    this.debounceCount = Math.max(1, Number(debounceCount) || 1);
    this.now = now;
    this.pending = new Map();
    this.suppressions = new Map();
    this.events = [];
    this.sequence = 0;
  }

  listActive() {
    return this.events.filter((alarm) => alarm.state === "ACTIVE" || alarm.state === "ACKNOWLEDGED");
  }

  listEvents() {
    return [...this.events];
  }

  suppress(key, { until, operator }) {
    this.suppressions.set(key, { until, operator });
    this.pending.delete(key);
  }

  acknowledge(id, { operator, note = "" }) {
    const alarm = this.events.find((entry) => entry.id === id);
    if (!alarm || (alarm.state !== "ACTIVE" && alarm.state !== "ACKNOWLEDGED")) {
      throw new Error(`alarm_not_active: ${id}`);
    }
    alarm.state = "ACKNOWLEDGED";
    alarm.acknowledgedAt = this.now();
    alarm.acknowledgedBy = operator;
    alarm.acknowledgeNote = note;
    return alarm;
  }

  raise(condition) {
    const currentTime = this.now();
    const existing = this.listActive().find((alarm) => alarm.key === condition.key);
    if (existing) {
      existing.lastSeenAt = currentTime;
      existing.value = condition.value;
      return existing;
    }

    this.sequence += 1;
    const alarm = {
      id: `ALM${String(this.sequence).padStart(6, "0")}`,
      key: condition.key,
      deviceId: condition.deviceId,
      code: condition.code,
      severity: condition.severity,
      message: condition.message,
      value: condition.value,
      limit: condition.limit ?? null,
      state: "ACTIVE",
      firstSeenAt: currentTime,
      lastSeenAt: currentTime,
      acknowledgedAt: null,
      acknowledgedBy: null,
      clearedAt: null,
      clearReason: null,
    };
    this.events.push(alarm);
    return alarm;
  }

  evaluateDevice(signals, limits = {}) {
    const deviceId = signals.deviceId;
    const communicationLost = signals.quality === "BAD_COMM" || signals.quality === "STALE";
    this.evaluateCondition({
      key: `${deviceId}:COMMUNICATION_LOSS`,
      active: communicationLost,
      deviceId,
      code: "COMMUNICATION_LOSS",
      severity: "CRITICAL",
      message: "设备通信中断或数据过期",
      value: signals.quality,
    });

    if (Number.isFinite(limits.maxTemperature) && Number.isFinite(signals.temperature)) {
      this.evaluateCondition({
        key: `${deviceId}:OVER_TEMPERATURE`,
        active: signals.temperature > limits.maxTemperature,
        deviceId,
        code: "OVER_TEMPERATURE",
        severity: "WARNING",
        message: "电解液温度超过工程限值",
        value: signals.temperature,
        limit: limits.maxTemperature,
      });
    }

    for (const [field, code, label] of [
      ["flowPositive", "LOW_FLOW_POSITIVE", "正极循环流量低于工程限值"],
      ["flowNegative", "LOW_FLOW_NEGATIVE", "负极循环流量低于工程限值"],
    ]) {
      if (!Number.isFinite(limits.minFlow) || !Number.isFinite(signals[field])) continue;
      this.evaluateCondition({
        key: `${deviceId}:${code}`,
        active: signals[field] < limits.minFlow,
        deviceId,
        code,
        severity: "WARNING",
        message: label,
        value: signals[field],
        limit: limits.minFlow,
      });
    }

    return this.listActive();
  }

  evaluateCondition(condition) {
    const currentTime = this.now();
    if (!condition.active) {
      this.pending.delete(condition.key);
      this.clear(condition.key, "condition_restored");
      return null;
    }

    const suppression = this.suppressions.get(condition.key);
    if (suppression && Date.parse(currentTime) <= Date.parse(suppression.until)) {
      this.pending.delete(condition.key);
      return null;
    }
    if (suppression) this.suppressions.delete(condition.key);

    const existing = this.listActive().find((alarm) => alarm.key === condition.key);
    if (existing) {
      existing.lastSeenAt = currentTime;
      existing.value = condition.value;
      return existing;
    }

    const count = (this.pending.get(condition.key) || 0) + 1;
    this.pending.set(condition.key, count);
    if (count < this.debounceCount) return null;
    this.pending.delete(condition.key);

    return this.raise(condition);
  }

  clear(key, reason) {
    const alarm = this.listActive().find((entry) => entry.key === key);
    if (!alarm) return null;
    alarm.state = "CLEARED";
    alarm.clearedAt = this.now();
    alarm.clearReason = reason;
    return alarm;
  }
}

module.exports = { AlarmEngine };
