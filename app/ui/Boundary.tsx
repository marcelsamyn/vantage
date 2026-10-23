import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Empty } from "./primitives";

interface Props {
  /** Shown in the error message, e.g. "City". */
  name: string;
  children: ReactNode;
  /** Render nothing on failure (for headless services) and report instead. */
  silent?: boolean;
  onError?: (error: Error) => void;
}

/** Contains a plugin failure so one broken plugin never takes down the shell. */
export class Boundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack);
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <Empty
        title={`${this.props.name} stopped`}
        tone="error"
        center
        action={
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            Restart {this.props.name}
          </Button>
        }
      >
        <span className="mono">{error.message}</span>
      </Empty>
    );
  }
}
