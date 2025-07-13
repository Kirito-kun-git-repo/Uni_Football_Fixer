import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Log error to an error reporting service
    // console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 32, color: 'red' }}>
        <h2>Something went wrong.</h2>
        <p>Please refresh the page or contact support.</p>
      </div>;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
