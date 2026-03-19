export function getStudioHTML(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ElsiumAI Studio</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
	--bg: #1e1e2e;
	--bg-surface: #252536;
	--bg-hover: #2a2a3c;
	--bg-card: #2d2d40;
	--text: #cdd6f4;
	--text-muted: #7f849c;
	--accent: #89b4fa;
	--success: #a6e3a1;
	--error: #f38ba8;
	--warn: #f9e2af;
	--border: #3b3b52;
	--font: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}
body {
	background: var(--bg);
	color: var(--text);
	font-family: var(--font);
	font-size: 13px;
	line-height: 1.5;
}
.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 24px;
	border-bottom: 1px solid var(--border);
	background: var(--bg-surface);
}
.header h1 {
	font-size: 15px;
	font-weight: 600;
	color: var(--accent);
}
.header .status {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11px;
	color: var(--text-muted);
}
.header .dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--success);
}
.header .dot.disconnected { background: var(--error); }
.tabs {
	display: flex;
	border-bottom: 1px solid var(--border);
	background: var(--bg-surface);
	padding: 0 24px;
}
.tab {
	padding: 10px 20px;
	cursor: pointer;
	color: var(--text-muted);
	border-bottom: 2px solid transparent;
	transition: all 0.15s;
	font-size: 12px;
	font-family: var(--font);
	background: none;
	border-top: none;
	border-left: none;
	border-right: none;
}
.tab:hover { color: var(--text); }
.tab.active {
	color: var(--accent);
	border-bottom-color: var(--accent);
}
.content { padding: 24px; max-width: 1200px; margin: 0 auto; }
.panel { display: none; }
.panel.active { display: block; }
table {
	width: 100%;
	border-collapse: collapse;
	margin-top: 12px;
}
th {
	text-align: left;
	padding: 8px 12px;
	color: var(--text-muted);
	font-weight: 500;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	border-bottom: 1px solid var(--border);
}
td {
	padding: 8px 12px;
	border-bottom: 1px solid var(--border);
	font-size: 12px;
}
tr:hover td { background: var(--bg-hover); }
tr.expandable { cursor: pointer; }
.expand-row td {
	padding: 12px;
	background: var(--bg-surface);
}
.expand-row pre {
	white-space: pre-wrap;
	word-break: break-all;
	font-size: 11px;
	max-height: 400px;
	overflow-y: auto;
	padding: 12px;
	background: var(--bg);
	border-radius: 4px;
	border: 1px solid var(--border);
}
.status-ok { color: var(--success); }
.status-error { color: var(--error); }
.status-pending { color: var(--warn); }
.provider-anthropic { color: #d4a276; }
.provider-openai { color: #74c7ec; }
.provider-google { color: #a6e3a1; }
.provider-default { color: var(--text-muted); }
.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 16px;
	margin-bottom: 24px;
}
.card {
	background: var(--bg-card);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 16px;
}
.card .label {
	font-size: 11px;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.5px;
	margin-bottom: 4px;
}
.card .value {
	font-size: 22px;
	font-weight: 600;
	color: var(--accent);
}
.bar-chart { margin-top: 16px; }
.bar-row {
	display: flex;
	align-items: center;
	margin-bottom: 8px;
	gap: 12px;
}
.bar-label {
	min-width: 200px;
	font-size: 12px;
	text-align: right;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.bar-track {
	flex: 1;
	height: 20px;
	background: var(--bg-surface);
	border-radius: 4px;
	overflow: hidden;
}
.bar-fill {
	height: 100%;
	background: var(--accent);
	border-radius: 4px;
	transition: width 0.3s;
	min-width: 2px;
}
.bar-value {
	min-width: 80px;
	font-size: 11px;
	color: var(--text-muted);
}
.live-stream {
	background: var(--bg-surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 16px;
	height: calc(100vh - 200px);
	overflow-y: auto;
	font-size: 12px;
}
.live-event {
	padding: 6px 0;
	border-bottom: 1px solid var(--border);
	display: flex;
	gap: 12px;
}
.live-event .time { color: var(--text-muted); min-width: 80px; }
.live-event .type {
	min-width: 80px;
	font-weight: 500;
}
.empty-state {
	text-align: center;
	padding: 48px 24px;
	color: var(--text-muted);
}
.empty-state h3 {
	margin-bottom: 8px;
	color: var(--text);
	font-size: 14px;
}
.span-tree { padding-left: 20px; }
.span-node {
	padding: 4px 0;
	font-size: 12px;
}
.span-meta {
	color: var(--text-muted);
	font-size: 11px;
	padding-left: 16px;
}
</style>
</head>
<body>
<div class="header">
	<h1>ElsiumAI Studio</h1>
	<div class="status">
		<span class="dot" id="sse-dot"></span>
		<span id="sse-status">Connected</span>
	</div>
</div>
<div class="tabs">
	<button class="tab active" data-tab="traces">Traces</button>
	<button class="tab" data-tab="xray">Requests (X-Ray)</button>
	<button class="tab" data-tab="costs">Costs</button>
	<button class="tab" data-tab="live">Live</button>
</div>
<div class="content">
	<div id="traces" class="panel active"></div>
	<div id="xray" class="panel"></div>
	<div id="costs" class="panel"></div>
	<div id="live" class="panel">
		<div class="live-stream" id="live-stream"></div>
	</div>
</div>
<script>
(function() {
	const tabs = document.querySelectorAll('.tab')
	const panels = document.querySelectorAll('.panel')
	const dot = document.getElementById('sse-dot')
	const sseStatus = document.getElementById('sse-status')
	const liveStream = document.getElementById('live-stream')

	tabs.forEach(function(tab) {
		tab.addEventListener('click', function() {
			tabs.forEach(function(t) { t.classList.remove('active') })
			panels.forEach(function(p) { p.classList.remove('active') })
			tab.classList.add('active')
			document.getElementById(tab.dataset.tab).classList.add('active')
		})
	})

	function escapeHtml(str) {
		var d = document.createElement('div')
		d.textContent = str
		return d.innerHTML
	}

	function formatDuration(ms) {
		if (ms == null) return '?'
		if (ms < 1000) return ms + 'ms'
		return (ms / 1000).toFixed(2) + 's'
	}

	function formatCost(c) {
		if (c == null) return '$0.00'
		return '$' + c.toFixed(6)
	}

	function statusClass(s) {
		if (s === 'ok') return 'status-ok'
		if (s === 'error') return 'status-error'
		return 'status-pending'
	}

	function providerClass(p) {
		if (!p) return 'provider-default'
		var l = p.toLowerCase()
		if (l.indexOf('anthropic') >= 0) return 'provider-anthropic'
		if (l.indexOf('openai') >= 0) return 'provider-openai'
		if (l.indexOf('google') >= 0 || l.indexOf('gemini') >= 0) return 'provider-google'
		return 'provider-default'
	}

	function buildSpanTree(spans, parentId) {
		var children = spans.filter(function(s) { return s.parentId === parentId })
		if (children.length === 0) return ''
		var html = '<div class="span-tree">'
		children.forEach(function(span) {
			var st = span.status === 'ok' ? 'OK' : span.status === 'error' ? 'ERR' : '...'
			var cls = statusClass(span.status)
			html += '<div class="span-node">'
			html += '<span class="' + cls + '">[' + st + ']</span> '
			html += '<strong>' + escapeHtml(span.name) + '</strong> '
			html += '<span style="color:var(--text-muted)">' + escapeHtml(span.kind || '') + '</span> '
			html += formatDuration(span.durationMs)
			if (span.metadata && Object.keys(span.metadata).length > 0) {
				html += '<div class="span-meta">' + escapeHtml(JSON.stringify(span.metadata)) + '</div>'
			}
			if (span.events && span.events.length > 0) {
				span.events.forEach(function(ev) {
					html += '<div class="span-meta">> ' + escapeHtml(ev.name)
					if (ev.data) html += ': ' + escapeHtml(JSON.stringify(ev.data))
					html += '</div>'
				})
			}
			html += buildSpanTree(spans, span.id)
			html += '</div>'
		})
		html += '</div>'
		return html
	}

	function renderTraces(data) {
		var el = document.getElementById('traces')
		if (!data || data.length === 0) {
			el.innerHTML = '<div class="empty-state"><h3>No traces yet</h3><p>Run your app with tracing enabled to see data here.</p></div>'
			return
		}
		var html = '<table><thead><tr><th>Trace ID</th><th>Name</th><th>Kind</th><th>Duration</th><th>Status</th></tr></thead><tbody>'
		data.forEach(function(trace, i) {
			var root = null
			var spans = Array.isArray(trace) ? trace : (trace.spans || [trace])
			for (var j = 0; j < spans.length; j++) {
				if (!spans[j].parentId) { root = spans[j]; break }
			}
			if (!root && spans.length > 0) root = spans[0]
			if (!root) return
			var st = root.status === 'ok' ? 'OK' : root.status === 'error' ? 'ERR' : '...'
			var cls = statusClass(root.status)
			html += '<tr class="expandable" data-idx="' + i + '">'
			html += '<td>' + escapeHtml(root.traceId || '') + '</td>'
			html += '<td>' + escapeHtml(root.name || '') + '</td>'
			html += '<td>' + escapeHtml(root.kind || '') + '</td>'
			html += '<td>' + formatDuration(root.durationMs) + '</td>'
			html += '<td class="' + cls + '">' + st + '</td>'
			html += '</tr>'
			html += '<tr class="expand-row" id="trace-expand-' + i + '" style="display:none"><td colspan="5">'
			html += '<strong>Spans (' + spans.length + ')</strong>'
			var roots = spans.filter(function(s) { return !s.parentId })
			if (roots.length === 0 && spans.length > 0) roots = [spans[0]]
			roots.forEach(function(r) {
				var rSt = r.status === 'ok' ? 'OK' : r.status === 'error' ? 'ERR' : '...'
				var rCls = statusClass(r.status)
				html += '<div class="span-node">'
				html += '<span class="' + rCls + '">[' + rSt + ']</span> '
				html += '<strong>' + escapeHtml(r.name) + '</strong> '
				html += '<span style="color:var(--text-muted)">' + escapeHtml(r.kind || '') + '</span> '
				html += formatDuration(r.durationMs)
				if (r.metadata && Object.keys(r.metadata).length > 0) {
					html += '<div class="span-meta">' + escapeHtml(JSON.stringify(r.metadata)) + '</div>'
				}
				if (r.events && r.events.length > 0) {
					r.events.forEach(function(ev) {
						html += '<div class="span-meta">> ' + escapeHtml(ev.name)
						if (ev.data) html += ': ' + escapeHtml(JSON.stringify(ev.data))
						html += '</div>'
					})
				}
				html += buildSpanTree(spans, r.id)
				html += '</div>'
			})
			html += '</td></tr>'
		})
		html += '</tbody></table>'
		el.innerHTML = html
		el.querySelectorAll('.expandable').forEach(function(row) {
			row.addEventListener('click', function() {
				var target = document.getElementById('trace-expand-' + row.dataset.idx)
				target.style.display = target.style.display === 'none' ? '' : 'none'
			})
		})
	}

	function renderXray(data) {
		var el = document.getElementById('xray')
		if (!data || data.length === 0) {
			el.innerHTML = '<div class="empty-state"><h3>No X-Ray data yet</h3><p>Enable X-Ray mode on your gateway to capture LLM call details.</p></div>'
			return
		}
		var html = '<table><thead><tr><th>Provider</th><th>Model</th><th>Latency</th><th>Tokens</th><th>Cost</th><th>Time</th></tr></thead><tbody>'
		data.forEach(function(entry, i) {
			var pc = providerClass(entry.provider)
			var tokens = (entry.usage ? entry.usage.totalTokens : 0) || 0
			var cost = entry.cost ? entry.cost.totalCost : 0
			var time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''
			html += '<tr class="expandable" data-idx="' + i + '">'
			html += '<td class="' + pc + '">' + escapeHtml(entry.provider || '') + '</td>'
			html += '<td>' + escapeHtml(entry.model || '') + '</td>'
			html += '<td>' + formatDuration(entry.latencyMs) + '</td>'
			html += '<td>' + tokens.toLocaleString() + '</td>'
			html += '<td>' + formatCost(cost) + '</td>'
			html += '<td>' + escapeHtml(time) + '</td>'
			html += '</tr>'
			html += '<tr class="expand-row" id="xray-expand-' + i + '" style="display:none"><td colspan="6">'
			html += '<pre>' + escapeHtml(JSON.stringify(entry, null, 2)) + '</pre>'
			html += '</td></tr>'
		})
		html += '</tbody></table>'
		el.innerHTML = html
		el.querySelectorAll('.expandable').forEach(function(row) {
			row.addEventListener('click', function() {
				var target = document.getElementById('xray-expand-' + row.dataset.idx)
				target.style.display = target.style.display === 'none' ? '' : 'none'
			})
		})
	}

	function renderCosts(data) {
		var el = document.getElementById('costs')
		if (!data || (!data.totalCost && !data.callCount)) {
			el.innerHTML = '<div class="empty-state"><h3>No cost data yet</h3><p>Enable cost tracking in your app to see data here.</p></div>'
			return
		}
		var html = '<div class="cards">'
		html += '<div class="card"><div class="label">Total Cost</div><div class="value">' + formatCost(data.totalCost) + '</div></div>'
		html += '<div class="card"><div class="label">Total Tokens</div><div class="value">' + (data.totalTokens || 0).toLocaleString() + '</div></div>'
		html += '<div class="card"><div class="label">API Calls</div><div class="value">' + (data.callCount || 0) + '</div></div>'
		html += '</div>'
		if (data.byModel && Object.keys(data.byModel).length > 0) {
			html += '<table><thead><tr><th>Model</th><th>Cost</th><th>Tokens</th><th>Calls</th></tr></thead><tbody>'
			var maxCost = 0
			for (var k in data.byModel) {
				if (data.byModel[k].cost > maxCost) maxCost = data.byModel[k].cost
			}
			for (var model in data.byModel) {
				var s = data.byModel[model]
				html += '<tr>'
				html += '<td>' + escapeHtml(model) + '</td>'
				html += '<td>' + formatCost(s.cost) + '</td>'
				html += '<td>' + (s.tokens || 0).toLocaleString() + '</td>'
				html += '<td>' + (s.calls || 0) + '</td>'
				html += '</tr>'
			}
			html += '</tbody></table>'
			html += '<div class="bar-chart" style="margin-top:24px">'
			for (var model2 in data.byModel) {
				var s2 = data.byModel[model2]
				var pct = maxCost > 0 ? (s2.cost / maxCost * 100) : 0
				html += '<div class="bar-row">'
				html += '<div class="bar-label">' + escapeHtml(model2) + '</div>'
				html += '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>'
				html += '<div class="bar-value">' + formatCost(s2.cost) + '</div>'
				html += '</div>'
			}
			html += '</div>'
		}
		el.innerHTML = html
	}

	function addLiveEvent(type, data) {
		var now = new Date().toLocaleTimeString()
		var typeColor = 'var(--text)'
		if (type === 'trace') typeColor = 'var(--accent)'
		else if (type === 'xray') typeColor = 'var(--warn)'
		else if (type === 'cost') typeColor = 'var(--success)'
		var div = document.createElement('div')
		div.className = 'live-event'
		div.innerHTML = '<span class="time">' + escapeHtml(now) + '</span>'
			+ '<span class="type" style="color:' + typeColor + '">' + escapeHtml(type) + '</span>'
			+ '<span>' + escapeHtml(typeof data === 'string' ? data : JSON.stringify(data)) + '</span>'
		liveStream.appendChild(div)
		liveStream.scrollTop = liveStream.scrollHeight
	}

	function fetchData() {
		fetch('/api/traces').then(function(r) { return r.json() }).then(renderTraces).catch(function() {})
		fetch('/api/xray').then(function(r) { return r.json() }).then(renderXray).catch(function() {})
		fetch('/api/cost').then(function(r) { return r.json() }).then(renderCosts).catch(function() {})
	}

	function connectSSE() {
		var es = new EventSource('/api/events')
		es.onopen = function() {
			dot.classList.remove('disconnected')
			sseStatus.textContent = 'Connected'
		}
		es.onmessage = function(e) {
			try {
				var parsed = JSON.parse(e.data)
				addLiveEvent(parsed.type || 'update', parsed.file || parsed)
				fetchData()
			} catch(err) {
				addLiveEvent('event', e.data)
			}
		}
		es.onerror = function() {
			dot.classList.add('disconnected')
			sseStatus.textContent = 'Disconnected'
			es.close()
			setTimeout(connectSSE, 3000)
		}
	}

	fetchData()
	connectSSE()
})()
</script>
</body>
</html>`
}
