// Minimal React-compatible runtime (no external dependencies)
const React = (() => {
  let hooks = [];
  let effects = [];
  let hookIndex = 0;
  let rootComponent = null;
  let rootContainer = null;
  let renderQueued = false;

  const createElement = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(),
  });

  const render = (component, container) => {
    rootComponent = component;
    rootContainer = container;
    queueRender();
  };

  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(performRender);
  };

  const performRender = () => {
    renderQueued = false;
    hookIndex = 0;
    const tree = typeof rootComponent === 'function' ? rootComponent() : rootComponent;
    const dom = createDom(tree);
    if (rootContainer) {
      rootContainer.innerHTML = '';
      rootContainer.appendChild(dom);
    }
    runEffects();
  };

  const useState = (initial) => {
    const idx = hookIndex;
    if (hooks[idx] === undefined) {
      hooks[idx] = typeof initial === 'function' ? initial() : initial;
    }
    const setState = (value) => {
      const next = typeof value === 'function' ? value(hooks[idx]) : value;
      if (next !== hooks[idx]) {
        hooks[idx] = next;
        queueRender();
      }
    };
    hookIndex += 1;
    return [hooks[idx], setState];
  };

  const useEffect = (effect, deps) => {
    const idx = hookIndex;
    const prev = effects[idx];
    const changed =
      !prev || !deps || !prev.deps || deps.length !== prev.deps.length
        ? true
        : deps.some((d, i) => d !== prev.deps[i]);
    effects[idx] = { effect, deps, dirty: changed, cleanup: prev?.cleanup };
    hookIndex += 1;
  };

  const runEffects = () => {
    effects.forEach((entry, idx) => {
      if (!entry || !entry.dirty) return;
      if (typeof entry.cleanup === 'function') {
        try {
          entry.cleanup();
        } catch (err) {
          console.error(err);
        }
      }
      const cleanup = entry.effect();
      effects[idx] = { ...entry, dirty: false, cleanup };
    });
  };

  const createDom = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') {
      return document.createTextNode('');
    }
    if (typeof node === 'string' || typeof node === 'number') {
      return document.createTextNode(node);
    }
    if (Array.isArray(node)) {
      const frag = document.createDocumentFragment();
      node.forEach((child) => frag.appendChild(createDom(child)));
      return frag;
    }
    if (typeof node.type === 'function') {
      return createDom(node.type({ ...(node.props || {}), children: node.children }));
    }
    const el = document.createElement(node.type);
    const props = node.props || {};
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'children' || value === undefined || value === null) return;
      if (key === 'className') {
        el.setAttribute('class', value);
        return;
      }
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.substring(2).toLowerCase(), value);
        return;
      }
      if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
        return;
      }
      el.setAttribute(key, value);
    });
    (node.children || []).forEach((child) => el.appendChild(createDom(child)));
    return el;
  };

  return { createElement, useState, useEffect, render };
})();

const ReactDOM = {
  createRoot: (container) => ({
    render: (component) => React.render(component, container),
  }),
  render: (component, container) => React.render(component, container),
};

// Application code (authored in TS/JSX, bundled to plain JS)
const h = React.createElement;

const StatusBadge = ({ status, lastSeen }) =>
  h(
    'div',
    { className: `status ${status}` },
    h('span', { className: 'dot' }),
    status === 'online' ? 'Online' : 'Offline',
    lastSeen ? h('span', { className: 'hostname', style: { marginLeft: '8px' } }, lastSeen) : null
  );

const DeviceCard = ({ device }) =>
  h(
    'div',
    { className: 'card' },
    h(
      'div',
      { className: 'card-row' },
      h('div', null, h('div', { className: 'ip' }, device.ip), h('div', { className: 'hostname' }, device.hostname)),
      h(StatusBadge, { status: device.status, lastSeen: device.last_seen })
    ),
    h(
      'div',
      { className: 'card-row' },
      h('div', { className: 'meta' }, `MAC: ${device.mac || 'unknown'}`),
      h('div', { className: 'meta' }, device.status === 'online' ? 'reachable' : 'no response')
    )
  );

const App = () => {
  const [devices, setDevices] = React.useState([]);
  const [lastUpdated, setLastUpdated] = React.useState(null);

  const fetchDevices = async () => {
    try {
      const res = await fetch('/devices', { cache: 'no-store' });
      const data = await res.json();
      setDevices(Array.isArray(data) ? data : []);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch devices', err);
    }
  };

  React.useEffect(() => {
    fetchDevices();
    const id = setInterval(fetchDevices, 5000);
    return () => clearInterval(id);
  }, []);

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'page-header' },
      h('div', { className: 'title' }, 'Home Network Monitor'),
      h('div', { className: 'pill' }, lastUpdated ? `Updated ${lastUpdated}` : 'Loading...')
    ),
    devices.length === 0
      ? h('div', { className: 'empty' }, 'No devices discovered yet. Scanning your network...')
      : h(
          'div',
          { className: 'grid' },
          devices.map((device) => h(DeviceCard, { device, key: device.ip }))
        )
  );
};

const container = document.getElementById('root');
ReactDOM.createRoot(container).render(App);
