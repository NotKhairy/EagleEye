import React from 'react'

type State = { error: Error | null }

export default class ErrorBoundary extends React.Component<unknown, State> {
  constructor(props: unknown) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    // also log to console
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen bg-[#0B0F14] text-white flex items-center justify-center p-4">
          <div className="max-w-xl w-full rounded-lg border border-red-700 bg-[#2b0f12] px-6 py-5 text-sm text-red-200">
            <div className="font-semibold mb-2">Application error</div>
            <div className="whitespace-pre-wrap break-words text-xs">{String(this.state.error?.message)}</div>
            <div className="mt-3 text-xs text-gray-300">Open the browser console for a full stack trace.</div>
          </div>
        </div>
      )
    }

    return this.props.children as React.ReactElement
  }
}
