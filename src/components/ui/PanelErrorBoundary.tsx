import { Component, type ErrorInfo, type ReactNode } from "react"

interface PanelErrorBoundaryProps {
  /** Named in the fallback and the console entry, e.g. "Output". */
  label: string
  children: ReactNode
}

interface PanelErrorBoundaryState {
  message: string | null
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error)

/**
 * Keeps a render error inside one panel: the panel shows what went wrong instead of React
 * unmounting the whole app into a blank window. Remounting (a `key` change) clears the error.
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): PanelErrorBoundaryState {
    return { message: errorMessage(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`The ${this.props.label} panel failed to render`, error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children
    return (
      <div className="results__empty" role="alert">
        Couldn't show {this.props.label}: {this.state.message}
      </div>
    )
  }
}
