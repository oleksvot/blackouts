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

// Format interval in seconds as "N day(s) [N hour(s)]" or "[N hour(s)] [N minute(s)]" or "N second(s)"
function formatSeconds(s) {
  s = Math.round(s)
  var r = ''
  if (s >= 86400) {
    r += Math.floor(s / 86400) + ' day'+(s >= 172800 ? 's' : '')+' '
    s = s % 86400
  }
  if (s >= 3600) {
    r += Math.floor(s / 3600) + ' hour'+(s >= 7200 ? 's' : '')+' '
    s = s % 3600
  }
  if (s >= 60 && !r.includes('day')) {
    r += Math.floor(s / 60) + ' minute'+(s >= 120 ? 's' : '')+' '
    s = s % 60
  }
  if (!r) {
    r += s + ' second'+(s != 1 ? 's' : '')+' '
  }
  return r.trim()
}

// Convert date time from ISO format with timezone (we always use UTC on backend) to local timezone locale-specific format
function localDateTime(dt) {
  if (dt) {
    t = new Date(dt)
    return t.toLocaleDateString() + ' ' + t.toLocaleTimeString()
  } else {
    return ''
  }
}

// Usage: await sleep(milliseconds)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Show loading screen, hide main area
function loading() {
  document.getElementById('aloading').className=''
  document.getElementById('amain').className='hidden'
}

// Show main area, hide loading screen, initial unhide
function loaded() {
  document.getElementById('app').className=''
  document.getElementById('aloading').className='hidden'
  document.getElementById('amain').className=''
}