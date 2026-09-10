import { Component } from 'react';

// Keeps a rendering error in one panel from blanking the whole app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('渲染错误:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="error-box" style={{ margin: '16px 0' }}>
          <strong>该模块渲染失败，已停止以保护页面。</strong>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
            {String(this.state.error.message || this.state.error)}
          </div>
          <button className="btn secondary" style={{ marginTop: 10 }} onClick={this.reset}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
