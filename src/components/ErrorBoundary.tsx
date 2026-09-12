import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workshop rendering failed', error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="canvas-fallback" role="alert">
          <h2>The workbench could not render.</h2>
          <p>
            A WebGL-capable browser is needed for the 3D view. The object list and numeric editor
            are still available.
          </p>
          <button
            onClick={() => {
              this.setState({ failed: false });
              this.props.onRetry?.();
            }}
          >
            Retry 3D view
          </button>
        </div>
      );
    return this.props.children;
  }
}
