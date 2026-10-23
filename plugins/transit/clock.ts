/** Epoch time advances with elapsed time; a host wall-clock step is reported, never simulated as travel. */
export class TransitClock {
  private readonly epoch: number;
  private readonly started: number;
  constructor(private readonly wall: () => number = Date.now, private readonly elapsed: () => number = () => performance.now()) {
    this.epoch = wall();
    this.started = elapsed();
  }
  now(): number { return this.epoch + this.elapsed() - this.started; }
  get errorMs(): number { return Math.abs(this.wall() - this.now()); }
}
