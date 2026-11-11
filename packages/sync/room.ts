import { expectedPosition, type Command, type RoomState, type UserId } from './protocol';
export class Room {
  state: RoomState;
  private buffers = new Map<UserId, number>();
  private resumeAfterBuffer = false;
  constructor(
    saved?: RoomState,
    private now = Date.now,
  ) {
    const time = now();
    this.state = saved
      ? {
          ...saved,
          soloUserId: undefined,
          autoStart: false,
          playing: false,
          changedAtServerMs: time,
          version: saved.version + 1,
        }
      : {
          roomId: 'our-cinema',
          playing: false,
          positionMs: 0,
          changedAtServerMs: time,
          version: 0,
          durationMs: 0,
          bufferingEvents: 0,
          participants: [],
        };
    this.state.participants = (['owner', 'partner'] as const).map((userId) => ({
      userId,
      connected: false,
      ready: false,
      buffering: false,
      latencyMs: 0,
      driftMs: 0,
      lastSeen: time,
    }));
  }
  private required() {
    return this.state.participants.filter(
      (p) => !this.state.soloUserId || p.userId === this.state.soloUserId,
    );
  }
  private stamp() {
    this.state.version++;
  }
  private anchor() {
    this.state.positionMs = expectedPosition(this.state, this.now());
    this.state.changedAtServerMs = this.now();
  }
  connect(id: UserId) {
    const p = this.participant(id);
    if (p.connected && (!this.state.soloUserId || this.state.soloUserId === id)) {
      this.anchor();
      this.state.playing = false;
      this.resumeAfterBuffer = false;
    }
    p.connected = true;
    p.ready = false;
    p.buffering = false;
    p.lastSeen = this.now();
    this.buffers.delete(id);
    this.stamp();
  }
  disconnect(id: UserId) {
    if (!this.state.soloUserId || this.state.soloUserId === id) {
      this.anchor();
      this.state.playing = false;
      this.resumeAfterBuffer = false;
    }
    if (this.state.soloUserId === id) {
      this.state.soloUserId = undefined;
      this.state.autoStart = false;
    }
    Object.assign(this.participant(id), { connected: false, ready: false, buffering: false });
    this.buffers.delete(id);
    this.stamp();
  }
  participant(id: UserId) {
    return this.state.participants.find((p) => p.userId === id)!;
  }
  select(id: string, duration: number, autoStart = false) {
    this.state.autoStart = autoStart;
    this.state.soloUserId = undefined;
    this.state.jellyfinItemId = id;
    this.state.durationMs = duration;
    this.state.positionMs = 0;
    this.state.playing = false;
    this.state.changedAtServerMs = this.now();
    this.resumeAfterBuffer = false;
    this.buffers.clear();
    this.state.participants.forEach((p) => {
      p.ready = false;
      p.buffering = false;
    });
    this.stamp();
  }
  apply(id: UserId, event: Command) {
    const p = this.participant(id);
    p.lastSeen = this.now();
    switch (event.type) {
      case 'join':
        this.connect(id);
        return;
      case 'leave':
        this.disconnect(id);
        return;
      case 'heartbeat':
        p.latencyMs = event.latencyMs ?? p.latencyMs;
        p.driftMs = event.driftMs ?? p.driftMs;
        return;
      case 'watch-together':
        this.anchor();
        this.state.playing = false;
        this.state.autoStart = false;
        this.state.soloUserId = undefined;
        this.resumeAfterBuffer = false;
        this.state.participants.forEach((viewer) => {
          viewer.ready = false;
        });
        break;
      case 'leave-player':
        this.apply(id, { type: 'unready' });
        if (this.state.soloUserId === id) {
          this.state.soloUserId = undefined;
          this.state.autoStart = false;
        }
        break;
      case 'ready':
        if (!this.state.jellyfinItemId) throw new Error('Choose a movie first.');
        p.ready = true;
        if (
          this.state.soloUserId &&
          this.state.participants.every((p) => p.connected && p.ready && !p.buffering)
        ) {
          // Joining a solo viewer pauses at the shared position before the pair starts.
          this.anchor();
          this.state.playing = false;
          this.resumeAfterBuffer = false;
          this.state.soloUserId = undefined;
        }
        if (
          this.state.autoStart &&
          this.required().every((p) => p.connected && p.ready && !p.buffering)
        ) {
          this.state.autoStart = false;
          this.state.playing = true;
          this.state.changedAtServerMs = this.now();
        }
        break;
      case 'unready':
        p.ready = false;
        if (!this.state.soloUserId || this.state.soloUserId === id) {
          this.anchor();
          this.state.playing = false;
          this.resumeAfterBuffer = false;
        }
        break;
      case 'play':
        if (!this.state.jellyfinItemId) throw new Error('Choose a movie first.');
        const required = event.override ? [p] : this.required();
        if (required.some((p) => p.connected && p.buffering))
          throw new Error('Waiting for buffering to finish.');
        if (!required.every((p) => p.connected && p.ready))
          throw new Error('Both people need to be connected and ready.');
        this.anchor();
        if (event.override) this.state.soloUserId = id;
        this.state.playing = true;
        this.resumeAfterBuffer = false;
        break;
      case 'pause':
        this.state.autoStart = false;
        this.anchor();
        this.state.playing = false;
        this.resumeAfterBuffer = false;
        break;
      case 'seek':
        this.state.positionMs = Math.min(event.positionMs, this.state.durationMs || 86400000);
        this.state.changedAtServerMs = this.now();
        break;
      case 'buffering-started':
        if (!p.buffering) {
          p.buffering = true;
          this.buffers.set(id, this.now());
          this.state.bufferingEvents++;
        }
        break;
      case 'buffering-ended':
        p.buffering = false;
        this.buffers.delete(id);
        // A viewer may mark ready while still building a start cushion; an
        // automatic next-episode start then waits for that cushion too.
        if (
          (this.resumeAfterBuffer || this.state.autoStart) &&
          this.required().every((p) => p.connected && p.ready && !p.buffering)
        ) {
          this.state.changedAtServerMs = this.now();
          this.state.autoStart = false;
          this.state.playing = true;
          this.resumeAfterBuffer = false;
        }
        break;
      default:
        return;
    }
    this.stamp();
  }
  tick() {
    for (const p of this.state.participants)
      if (p.connected && this.now() - p.lastSeen > 15000) this.disconnect(p.userId);
    if (
      this.state.playing &&
      [...this.buffers.entries()].some(
        ([id, t]) =>
          (!this.state.soloUserId || id === this.state.soloUserId) && this.now() - t >= 1200,
      )
    ) {
      this.anchor();
      this.state.playing = false;
      this.resumeAfterBuffer = true;
      this.stamp();
    }
    if (
      this.state.playing &&
      this.state.durationMs &&
      expectedPosition(this.state, this.now()) >= this.state.durationMs
    ) {
      this.anchor();
      this.state.playing = false;
      this.resumeAfterBuffer = false;
      this.stamp();
    }
  }
  snapshot(): RoomState {
    return structuredClone(this.state);
  }
  durable(): RoomState {
    const s = this.snapshot();
    s.positionMs = expectedPosition(s, this.now());
    s.changedAtServerMs = this.now();
    s.playing = false;
    return s;
  }
}
