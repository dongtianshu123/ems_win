const PRIORITY = Object.freeze({
  EMS_STRATEGY: 1,
  DISPATCH: 2,
  COORDINATOR: 3,
  LOCAL: 4,
});

class ControlAuthority {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.lease = null;
  }

  current() {
    if (this.lease && this.lease.expiresAt <= this.now()) this.lease = null;
    return this.lease ? { ...this.lease } : null;
  }

  claim(source, { owner, ttlMs } = {}) {
    if (!PRIORITY[source] || typeof owner !== "string" || !owner || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return { granted: false, reason: "invalid_authority_request" };
    }
    const current = this.current();
    if (current && current.source === source && current.owner === owner) return this.renew(owner, ttlMs);
    if (current && PRIORITY[source] <= PRIORITY[current.source]) {
      return { granted: false, reason: "higher_or_equal_authority_active", current };
    }
    this.lease = { source, owner, grantedAt: this.now(), expiresAt: this.now() + ttlMs };
    return { granted: true, ...this.lease };
  }

  renew(owner, ttlMs) {
    const current = this.current();
    if (!current || current.owner !== owner || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return { granted: false, reason: "authority_owner_mismatch" };
    }
    this.lease.expiresAt = this.now() + ttlMs;
    return { granted: true, ...this.lease };
  }

  release(owner) {
    const current = this.current();
    if (!current || current.owner !== owner) return false;
    this.lease = null;
    return true;
  }

  canExecute(source, owner) {
    const current = this.current();
    return Boolean(current && current.source === source && current.owner === owner);
  }
}

module.exports = { ControlAuthority, PRIORITY };
