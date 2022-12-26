// Blackouts@HomServ - uptime monitoring service for home internet connection
// Copyright (C) 2022 Oleksandr Titarenko <admin@homserv.net>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// WebSocket URL. See watch handler in blackouts.py. If APP_URL is https, using the wss scheme
ws_url = APP_URL.replace(/^http/, 'ws') + "/u/watch"


// Refresh every 55 seconds, regardless of WebSocket
ws_refresh_interval = 55000
// Send keepalive every 25 seconds
ws_check_interval = 25000
// Reconnect after 25 seconds of inactivity
ws_timeout = 35000

// WebSocket object
ws_socket = null
// Time of receipt of the last message
ws_timestamp = 0
// Currect resource_id
ws_subscribe = ''
// Next update time
ws_next_refresh = +new Date() + ws_refresh_interval
// Connection status
ws_alive = false
// Currect refresh callback. Yes, only one at the moment, by desing
ws_global_refresh = null

ws_global_refresh = () => {
  console.log('Nothing to refresh')
}

// The client key is used for server side optimization. Only one socket is allowed per key. We could store this in cookies 
// or sessionStorage, but this will not work correctly if multiple copies of the application are open in different windows/tabs.
ws_socket_key = new Array(20).join().replace(/(.|$)/g, () => ((Math.random()*36)|0).toString(36))

// Currect locale date time string. Updated every second, if online.
// It also written to html elements with ws_now class, with offline warning.
ws_now = ''

// resource_id (ws_subscribe) - may be device id, edit/view token, or * for all devices
// callback (ws_global_refresh) - called when device is updated or by timer
function ws_start(resource_id=null, callback=null) {
  if (resource_id) { ws_subscribe = resource_id }
  if (callback) { ws_global_refresh = callback }
  
  var cmd = ws_subscribe + '@' + ws_socket_key

  if (ws_socket && ws_timestamp + ws_timeout >= new Date()) {
    try {
      ws_socket.send(cmd)
      console.log('subscribed to', cmd)
      return
    } catch {
      console.log('WebSocket error, reconnecting')
    }
  }

  // (re)connect
  ws_alive = false
  try {
    ws_socket.onclose = () => {
      console.log('closed')
    }
    ws_socket.close()
  } catch {}
  ws_socket = new WebSocket(ws_url);
  ws_socket.onopen = (event) => {
    if (ws_socket) {
      console.log('connected to ', ws_url)
      ws_socket.send(cmd)
      console.log('subscribed to ', cmd)
    }
  }
  ws_socket.onmessage = (event) => {
    if (event.data == 'refresh') {
      console.log('refresh by WebSocket')
      ws_global_refresh()
    }
    // keepalive - set timestamp
    ws_timestamp = +new Date()
    ws_alive = true
  }
  ws_socket.onclose = () => {
    console.log('WebSocket closed, reconnecting')
    ws_timestamp = 0
    setTimeout(ws_start, 2000)
  }
}

// Every ws_check_interval
setInterval(() => {
  try {
    // send keepalive
    ws_socket.send('.')
  } catch {
    console.log('WebSocket error, reconnecting')
    ws_timestamp = 0
  }
  if (ws_timestamp + ws_timeout < new Date()) {
    ws_start()
  }
}, ws_check_interval)


// Every second
setInterval(() => {
  // It looks strange, but works properly when waking up from any kind of sleep and hibernation
  if (ws_next_refresh < new Date()) {
    console.log('refresh by timer')
    ws_global_refresh()
    ws_next_refresh = +new Date() + ws_refresh_interval
  }
  var clocks = document.getElementsByClassName('ws_now')
  if (ws_alive) {
    var now = new Date()
    ws_now = now.toLocaleDateString() + ' ' + now.toLocaleTimeString()
  }
  for (var n = 0; n < clocks.length; n ++) {
    clocks[n].innerHTML = (ws_alive ? '' : '<font color="red">[You are offline]</font> ') + ws_now
  }
}, 1000)
