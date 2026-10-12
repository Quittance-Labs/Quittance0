import type { Pool, PoolClient } from 'pg';
import { emitOperationalFailure } from '../observability/log-events';

export const PAYMENT_MONITOR_LOCK_ID = 742918452;

export interface LeaderLease {
  isLeader(): boolean;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  tryAcquire(): Promise<boolean>;
  renew(): Promise<boolean>;
  release(): Promise<void>;
  onElected?(callback: () => void): void;
  onDemoted?(callback: () => void): void;
}

export interface PostgresMonitorLeaderLeaseOptions {
  lockId?: number;
  intervalMs?: number;
}

/**
 * Manages an exclusive leader lease for payment monitoring across multi-replica
 * deployments using PostgreSQL session-level advisory locks.
 *
 * A dedicated PoolClient is checked out and held while the lock is active.
 * When the leader stops or disconnects, PostgreSQL automatically releases the
 * advisory lock, permitting another replica to take over leadership safely.
 */
export class PostgresMonitorLeaderLease implements LeaderLease {
  private readonly lockId: number;
  private readonly intervalMs: number;
  private dedicatedClient: PoolClient | null = null;
  private leader = false;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private electedCallbacks: Array<() => void> = [];
  private demotedCallbacks: Array<() => void> = [];

  constructor(
    private readonly dbPool: Pool,
    options: PostgresMonitorLeaderLeaseOptions = {}
  ) {
    this.lockId = options.lockId ?? PAYMENT_MONITOR_LOCK_ID;
    this.intervalMs = Math.max(100, options.intervalMs ?? 2_000);
  }

  isLeader(): boolean {
    return this.leader;
  }

  onElected(callback: () => void): void {
    this.electedCallbacks.push(callback);
  }

  onDemoted(callback: () => void): void {
    this.demotedCallbacks.push(callback);
  }

  private notifyElected(): void {
    for (const cb of this.electedCallbacks) {
      try {
        cb();
      } catch (err) {
        // Suppress listener errors
      }
    }
  }

  private notifyDemoted(): void {
    for (const cb of this.demotedCallbacks) {
      try {
        cb();
      } catch (err) {
        // Suppress listener errors
      }
    }
  }

  /**
   * Attempt to acquire the advisory lock on a dedicated client connection.
   */
  async tryAcquire(): Promise<boolean> {
    if (this.leader && this.dedicatedClient) {
      return true;
    }

    try {
      if (!this.dedicatedClient) {
        this.dedicatedClient = await this.dbPool.connect();
        this.dedicatedClient.on('error', (err) => {
          this.handleClientError(err);
        });
      }

      const res = await this.dedicatedClient.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [this.lockId]
      );
      const acquired = Boolean(res.rows[0]?.locked);

      if (acquired) {
        if (!this.leader) {
          this.leader = true;
          this.notifyElected();
        }
        return true;
      } else {
        // Did not acquire: release connection back to pool so standby doesn't starve pool
        this.cleanupClient();
        if (this.leader) {
          this.leader = false;
          this.notifyDemoted();
        }
        return false;
      }
    } catch (error) {
      emitOperationalFailure('database.connect', 'warn');
      this.cleanupClient();
      if (this.leader) {
        this.leader = false;
        this.notifyDemoted();
      }
      return false;
    }
  }

  /**
   * Renews or verifies that the advisory lock connection is alive and healthy.
   */
  async renew(): Promise<boolean> {
    if (!this.leader || !this.dedicatedClient) {
      return this.tryAcquire();
    }

    try {
      await this.dedicatedClient.query('SELECT 1');
      return true;
    } catch (err) {
      this.cleanupClient();
      this.leader = false;
      this.notifyDemoted();
      return this.tryAcquire();
    }
  }

  /**
   * Releases the advisory lock explicitly and returns the client to the pool.
   */
  async release(): Promise<void> {
    if (this.dedicatedClient) {
      try {
        await this.dedicatedClient.query('SELECT pg_advisory_unlock($1)', [this.lockId]);
      } catch (err) {
        // Suppress unlock errors if connection was already severed
      } finally {
        this.cleanupClient();
      }
    }
    if (this.leader) {
      this.leader = false;
      this.notifyDemoted();
    }
  }

  private cleanupClient(): void {
    if (this.dedicatedClient) {
      try {
        this.dedicatedClient.removeAllListeners('error');
        this.dedicatedClient.release();
      } catch {
        // Ignore release failures
      }
      this.dedicatedClient = null;
    }
  }

  private handleClientError(_err: Error): void {
    this.cleanupClient();
    if (this.leader) {
      this.leader = false;
      this.notifyDemoted();
    }
  }

  /**
   * Starts background election and maintenance loop.
   */
  async start(): Promise<boolean> {
    if (this.running) return this.leader;
    this.running = true;

    const acquired = await this.tryAcquire();
    this.scheduleCheck();
    return acquired;
  }

  /**
   * Stops the lease loop and releases leadership.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.release();
  }

  private scheduleCheck(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(async () => {
      if (!this.running) return;
      if (this.leader) {
        await this.renew();
      } else {
        await this.tryAcquire();
      }
      this.scheduleCheck();
    }, this.intervalMs);
  }
}

/**
 * Single-instance leader lease for in-memory MVP and test modes.
 */
export class SingleInstanceLeaderLease implements LeaderLease {
  private leader = true;

  isLeader(): boolean {
    return this.leader;
  }

  async start(): Promise<boolean> {
    this.leader = true;
    return true;
  }

  async stop(): Promise<void> {
    this.leader = false;
  }

  async tryAcquire(): Promise<boolean> {
    return true;
  }

  async renew(): Promise<boolean> {
    return true;
  }

  async release(): Promise<void> {
    this.leader = false;
  }
}
