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


// Make request to backend (APP_URL) and parse json
// On error, show message and for get only retry every 2 seconds max 30 times
async function request(uri, post_data=null) {
  var tries = 30
  var options = {cache: "no-store"}
  if (post_data) {
    tries = 1
    options.method = 'POST'
    options.body = JSON.stringify(post_data)
    options.headers = {
      'Content-Type': 'application/json'
    }
  }
  for (t = 0; t < tries; t ++) {
    var res = null
    var raw = null
    var js = null
    try {
      res = await fetch(APP_URL + uri, options)
      // We can't use both .text() and .json() for same response
      raw = await res.text()
      js = JSON.parse(raw)
    } catch {}
    if (res && res.ok && js) {
      app.server_error = null
      if (js.alert) { alert(js.alert) }
      return js
    }
    // Initial unhide
    document.getElementById('app').className=''
    app.server_error = js ? JSON.stringify(js, null, 2) : (raw ? raw : `fetch ${APP_URL}${uri} failed`)
    await sleep(2000)
  }
}

// Calculate uptime persent by given created date in ISO format and downtime in seconds
function calculateUptime(created, downtime) {
  const alltime = (new Date() - new Date(created)) / 1000
  const uptime = alltime - downtime
  return Math.round(uptime / alltime * 100)
}

// Cache manupulations and adding event for currenly down devices
function prepare_device() {
    if (this.device.error) {
      router.push('/not-found')
    }
    // Seconds elapsed since the last update
    var timed = (new Date() - new Date(this.device.updated)) / 1000
    var is_blackout_now = timed > (this.device.interval * BLACKOUT_COEFFICIENT)
    // We use cached device for downtime chart and table
    // Cache is updated if device is down now or corrected downtime or version is changed
    if (is_blackout_now || this.device.downtime_uncrossed != this.device_cached.downtime_uncrossed || 
      this.device.version != this.device_cached.version) {
      this.device_cached = this.device
      this.device_cached.events = this.device.events.sort((x,y) => {
        return x.id - y.id
      })
      for (var n = this.device_cached.events.length - 1; n >= 0; n --) {
        if (this.device_cached.events[n].downtime || n == 0) {
          this.device_cached.ended = this.device_cached.events[n].ended
          break
        }
      }
    }
    this.device.ended = this.device_cached.ended
    // Event on server side is added when device comes back online
    // So we add it here for currently offline devices
    // Event without id is displayed in a special way in the table
    if (is_blackout_now) {
      var downtime_now = {
        started: this.device.updated,
        ended: new Date().toISOString(),
        downtime: this.device.updated ? timed : null
      }
      this.device_cached.events.push(downtime_now)
    }
}

const deviceMixin = {
  computed: {
    timed () {
      return (new Date() - new Date(this.device.updated)) / 1000
    },
    alive () {
      return this.timed <= (this.device.interval + 5)
    },
    bulbSrc () {
      return 'img/' + ( this.alive ? 'on' : 'off' ) +'.png'
    },
    uptimeUncrossed() {
      return (this.alive && !this.device.downtime_uncrossed) ? 100 : calculateUptime(
          this.device.created, this.device.downtime_uncrossed + this.timed) 
    },
    uptimeCrossed() {
      return (this.alive && !this.device.downtime) ? 100 : calculateUptime(this.device.created, this.device.downtime + this.timed)
    },
    totalDowntimeCrossed() {
      return this.device.downtime ? formatSeconds(this.device.downtime + this.timed) : 'not yet'
    },
    totalDowntimeUncrossed() {
      return this.device.downtime_uncrossed ? formatSeconds(this.device.downtime_uncrossed + this.timed) : 'not yet'
    },
    updated() {
      return localDateTime(this.device.updated)
    },
    created() {
      return localDateTime(this.device.created)
    },
    registered() {
      return formatSeconds((new Date() - new Date(this.device.created)) / 1000)
    },
    isCorrected() {
      return this.device.downtime != this.device.downtime_uncrossed
    },
    uptimeTitle() {
      return ( this.isCorrected ? 'Corrected' : 'Real') + ' uptime for ' + this.registered
        
    },
    uptimeRealTitle() {
      return 'Real uptime for ' + this.registered
    },
    downtime() {
      return formatSeconds(this.timed)
    },
    alivetime() {
      if (this.device.ended) {
        return formatSeconds((new Date(this.device.updated) - 
          new Date(this.device.ended)) / 1000)
      } else {
        return ''
      }      
    }
  }
}

Vue.component('downtime-table', {
  props: ['device', 'edit'],
  template: `<b-table :items="events" :fields="fields" dark stacked="md">
    <template #cell(started)="data">
      <span v-if="edit && data.item.id">
        <b-icon :icon="data.item.crossed ? 'x-circle' : 'bookmark-x-fill'" class="clickable" @click="toogle(data.item.id)"></b-icon>
      </span>
      <span>{{ data.value }}</span>
    </template>
    <template #cell(ended)="data">
      <span v-if="!data.item.id" class="downnow ws_now"></span>
      <span v-if="data.item.id">{{ data.value }}</span>
    </template>
    <template #cell(duration)="data">
      <span v-if="edit && data.item.id">
        <b-icon-pen-fill class="clickable" @click="comment(data.item.id)"></b-icon-pen-fill>
      </span>
      <span v-if="data.value">{{ data.value }} down<br></span>
      <span v-if="data.item.old_ip">IP changed from <i>{{ data.item.old_ip }}</i><br>
      to <i>{{ data.item.new_ip }}</i><br></span>
      <span v-if="!data.item.started && data.item.new_ip">Device registered<br>IP <i>{{ data.item.new_ip }}</i><br></span>
      <span v-if="data.item.comment" class="ecomment">{{ data.item.comment }}</span>
    </template>
  </b-table>`,
  data() {
    return {
      events: [],
      fields: ['started', 'ended', 'duration']
    }
  },
  methods: {
    async toogle(id) {
      var res = await request("/u/toogle_event/" + this.edit, {id: id})
      if (res.ok) {
        ws_global_refresh()
      }
    },
    async comment(id) {
      var comment = prompt('Add comment')
      var res = await request("/u/add_comment/" + this.edit, {id: id, comment: comment})
      if (res.ok) {
        this.events = this.events.map((event) => {
          if (event.id == id) {
            event.comment = comment
          }
          return event
        })
      }
    }
  },
  watch: {
    device (device) {
      this.events = this.device.events.map(event => {
        return {
          id: event.id,
          started: localDateTime(event.started),
          ended: localDateTime(event.ended),
          duration: event.downtime ? formatSeconds(event.downtime): null,
          old_ip: event.old_ip,
          new_ip: event.new_ip,
          comment: event.comment,
          _rowVariant: event.crossed ? 'crossed' : '',
          crossed: event.crossed
        }
      }).reverse()
    }
  }
})

Vue.component('device-info', {
  props: ['device'],
  mixins: [deviceMixin],
  template: `<div>
  <b-row class="deviceinfo">
    <b-col lg title="Current IP address">
      <b-icon-globe></b-icon-globe>
      <small>{{ device.ip }}{{ (device.ip && device.ip.endsWith(device.country+')')) ? '' : device.country }}</small>
    </b-col>
    
    <b-col lg title="Registered">
      <b-icon-calendar-check></b-icon-calendar-check> {{ created }} <small class="nowrap">({{ registered }})</small>
    </b-col>
  </b-row>
  <b-row class="deviceinfo">
    <b-col lg class="nowrap bulbs">
      <b-button variant="success" size="sm" :title="uptimeTitle">uptime {{ uptimeUncrossed }}%</b-button>
      <b-button variant="secondary" size="sm" v-if="isCorrected" :title="uptimeRealTitle">
        real uptime {{ uptimeCrossed }}%
      </b-button>
    </b-col>
    <b-col lg title="Last update">
      <b-icon-clock></b-icon-clock> {{ updated }} <small>(every {{ device.interval }} sec)
      </small>
    </b-col>
  </b-row>
  <b-row class="deviceinfo">
    <b-col lg class="nowrap bulbs">
      <img :src="bulbSrc" class="sbulb">
      <span v-if="! alive" class="nowrap"><font color="red">{{ downtime }} down</font></span>
      <span v-if="alive" class="nowrap"><font color="green">online {{ alivetime }}</font></span>
    </b-col>
    <b-col lg v-if="isCorrected">
      <span class="nowrap">Total downtime (corrected): <font color="red">{{ totalDowntimeUncrossed }}</font></span>
    </b-col>
    <b-col lg>
      <span class="nowrap">Total downtime: <font :color="isCorrected ? 'yellow' : 'red'">
      {{ totalDowntimeCrossed }}</font></span>
    </b-col>
  </b-row>
  </div>`,
  watch: {
    device(device) {
      app.bigBulb = this.alive
    }
  }
})

// /e/<edit_token>
const DeviceEdit = {
  template: `<div>
      <h3>{{ device.title }}</h3>
      <b-container>
      <device-info :device="device" :class="{hidden: !device.updated}"></device-info>

      <b-button block @click="show_instructions = ! show_instructions">Setup instructions</b-button>
      <b-collapse v-model="show_instructions">
        <b-card>
           <b-form-row>
            <b-col lg>
              <b-form-group label="Permanent link to this page:" description="Please save this link. It's not recoverable.">
              <b-input-group>
                <b-form-input :value="edit_url" @click="copyToClipboard" readonly></b-form-input>
                <b-input-group-append>
                  <b-button variant="outline-secondary" @click="changeToken('edit')">
                    <b-icon-arrow-repeat></b-icon-arrow-repeat>
                  </b-button>
                </b-input-group-append>
              </b-input-group>
              </b-form-group>
            </b-col>
            <b-col class="width-auto hidden-sm">
              <div id="qrcode"></div>
            </b-col>
          </b-form-row>
          <b-form-row>
          <b-col lg>
            <b-form-group label="Your UPDATE URL:">
            <b-input-group>
                <b-form-input :value="update_url" @click="copyToClipboard" readonly></b-form-input>
                <b-input-group-append>
                  <b-button variant="outline-secondary" @click="changeToken('update')">
                    <b-icon-arrow-repeat></b-icon-arrow-repeat>
                  </b-button>
                </b-input-group-append>
              </b-input-group>
            </b-form-group>
          </b-col>
          </b-form-row>
          <p>All you need to do is set up your device to make a request to this url every <b>{{ device.interval }} seconds</b>.</p>
          <b-button block v-b-toggle.accordion-1>For Linux</b-button> 
          <b-collapse id="accordion-1" accordion="my-accordion" role="tabpanel">
            <br>
            <p><a href="https://openwrt.org/docs/guide-quick-start/sshadministration" target="_blank">SSH into your router</a> 
            and execute following command (as root):</p>
            <b-form-textarea v-model="ssh_command" @click="copyToClipboard" readonly rows="3" max-rows="30"></b-form-textarea>
            <p>Also, make sure that cron and curl are installed on your system.</p>
            
          </b-collapse>
          <b-button block v-b-toggle.accordion-2>For Android</b-button>
          
          <b-collapse id="accordion-2" accordion="my-accordion" role="tabpanel">
            <br>
            <p>First, install <a href="https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid" target="_blank">
              MacroDroid App</a> from Google Play</p>
            <p>Then download and open macro file, and tap on 
              <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADMAAAAmCAYAAABpuqMCAAABhGlDQ1BJQ0MgcHJvZmlsZQAAK
              JF9kT1Iw0AYht+mFkUqDmYQcchQnSyIijpKFYtgobQVWnUwufQPmjQkKS6OgmvBwZ/FqoOLs64OroIg+APi6OSk6CIlfpcUWsR4x3EP73
              3vy913gNCoMM3qGgc03TZT8ZiUza1K3a8I0xQRwozMLCORXszAd3zdI8D3uyjP8q/7c/SpeYsBAYl4jhmmTbxBPL1pG5z3iUVWklXic+I
              xky5I/Mh1xeM3zkWXBZ4pmpnUPLFILBU7WOlgVjI14iniiKrplC9kPVY5b3HWKjXWuid/YTivr6S5TmsYcSwhgSQkKKihjApsRGnXSbGQ
              ovOYj3/I9SfJpZCrDEaOBVShQXb94H/wu7dWYXLCSwrHgNCL43yMAN27QLPuON/HjtM8AYLPwJXe9lcbwOwn6fW2FjkC+reBi+u2puwBl
              zvA4JMhm7IrBWkJhQLwfkbflAMGboHeNa9vrXOcPgAZ6tXyDXBwCIwWKXvd5909nX37t6bVvx+TCHK0W5EJYwAAAAZiS0dEAP8A/wD/oL
              2nkwAAAAlwSFlzAAAuIwAALiMBeKU/dgAAAAd0SU1FB+YMDBQaIBOD0TkAAAAZdEVYdENvbW1lbnQAQ3JlYXRlZCB3aXRoIEdJTVBXgQ4
              XAAAAfklEQVRYw+2W0QqAIAxFt9GH++e3d9FCbCJ5DvRSsHVw7WYGAMfirZuSlNrU3TPqxp9OBhkAIGdmcibMTL1+9XNWMzIbcT3MdCZa
              JpPVjDE7VSYlZ95y5OucYsyQ2eRbmrmG6qnCSonB+v0FsBp+NJFBBhlktlvNjfeQAUA6N3tQMUS34JXkAAAAAElFTkSuQmCC">
            </p>
            <p>Download:</p>
            <p><a :href="macro_link + '&alarm=false'">uptime.macro</a> (recommended)</p>
            <p><a :href="macro_link + '&alarm=true'">uptime.macro</a> (alternative version, uses system alarm)</p>
            
            
          </b-collapse>
        </b-card>
      </b-collapse>

      
      <b-form @submit.prevent="onSubmit" @reset.prevent="onReset">
      <b-button block @click="show_settings = ! show_settings">Device information</b-button>
      <b-collapse v-model="show_settings">
        <b-card>
        <b-form-row>
          <b-col lg>
            <b-form-group label="Title:">
              <b-form-input v-model="editable.title" placeholder="Device title" maxlength="30" required></b-form-input>
            </b-form-group>
          </b-col>
          <b-col lg>
            <b-form-group label="Update interval:" class="interval-r">
              <b-input-group append="seconds">
                <b-form-input v-model.number="editable.interval" type="number" min="${MIN_INTERVAL}" max="${MAX_INTERVAL}" required>
                </b-form-input>
              </b-input-group>
            </b-form-group>
          </b-col>  
        </b-form-row>

        <b-form-row>
          <b-col lg>
            <b-form-group label="Location:">
              <b-form-input v-model="editable.location" placeholder="City, Country" maxlength="100"></b-form-input>
            </b-form-group>
          </b-col>
          <b-col lg>
            <b-form-group label="ISP:">
              <b-form-input v-model="editable.isp" placeholder="Internet service provider" maxlength="50"></b-form-input>
            </b-form-group>
          </b-col>
        </b-form-row>

        <b-form-row>
          <b-col lg>
            <b-form-group label="Battery:">
              <b-input-group>
              <b-input-group-prepend is-text>
                <b-form-checkbox switch v-model="editable.battery">
                </b-form-checkbox>
              </b-input-group-prepend>
              <b-form-input v-model="editable.battery_comment" placeholder="Battery capacity" maxlength="100">
              </b-form-input>
              </b-input-group>
            </b-form-group>
          </b-col>
           <b-col lg>
            <b-form-group label="Reserve connection:">
              <b-input-group>
              <b-input-group-prepend is-text>
                <b-form-checkbox switch v-model="editable.reserve">
                </b-form-checkbox>
              </b-input-group-prepend>
              <b-form-input v-model="editable.reserve_comment" placeholder="Reserve ISP" maxlength="100">
              </b-form-input>
              </b-input-group>
            </b-form-group>
          </b-col>
        </b-form-row>
        <b-form-row>
          <b-col lg>
            <b-form-textarea v-model="editable.notes" placeholder="Notes">
            </b-form-textarea>
          </b-col>
        </b-form-row>
        
        <b-form-row class="public-r">
          <b-col lg>
            <b-form-checkbox switch size="lg" v-model="editable.public">
              Public device (show on the main page)</b-form-checkbox>
          </b-col>
        </b-form-row>
        <b-form-row>
          <b-col lg>
            <b-input-group prepend="View URL">
              <b-form-input :value="view_url" @click="copyToClipboard" readonly></b-form-input>
              <b-input-group-append>
                <b-button variant="outline-secondary" @click="changeToken('view')"><b-icon-arrow-repeat></b-icon-arrow-repeat></b-button>
              </b-input-group-append>
            </b-input-group>
          </b-col>
        </b-form-row>
        </b-card>
      </b-collapse>
      <b-button block @click="show_notifications = ! show_notifications">Notifications</b-button>
      <b-collapse v-model="show_notifications">
        <b-card>
        <b-form-row>
          <b-col lg>
            <b-form-group label="Email address:" label-for="email" 
              description="Your email will only be used for device status notifications. We'll never share it with anyone else.">
              <b-input-group>
                <b-form-input ref="eml" @input="emailChange" v-model.trim="editable.email" 
                  type="email" placeholder="Enter email">
                </b-form-input>
                <b-input-group-append v-if="email_confirmed">
                  <b-button variant="success" disabled>
                  <b-icon-check-circle></b-icon-check-circle> Confirmed</b-button>
                </b-input-group-append>
                <b-input-group-append v-if="email_show_confirm">
                  <b-button variant="primary" v-b-modal.modal-email-verification>
                    <b-icon-envelope></b-icon-envelope> Confirm email
                  </b-button>
                </b-input-group-append>
                <b-input-group-append v-if="email_incorrect">
                  <b-button variant="danger" disabled><b-icon-x-circle></b-icon-x-circle> Incorrect email</b-button>
                </b-input-group-append>
              </b-input-group>
            </b-form-group>
          </b-col>
        </b-form-row>
        
         <b-form-row>
          <b-col lg="auto" class="notification-r">
            <b-form-checkbox switch size="lg" v-model="editable.notifyoff" v-if="email_confirmed">
              Notify when device is down</b-form-checkbox>
            <b-form-checkbox switch size="lg" v-if="!email_confirmed" disabled>
              Notify when device is down</b-form-checkbox>
          </b-col>
          <b-col lg class="interval-r">
            <b-input-group append="seconds">
              <b-form-input v-model.number="editable.notify_interval" type="number" min="${MIN_INTERVAL}" max="${MAX_INTERVAL}" required>
              </b-form-input>
            </b-input-group>
          </b-col>
          <b-col lg class="notification-r">
            <b-form-checkbox switch size="lg" v-model="editable.notifyon" v-if="email_confirmed">
              Notify when device is online again</b-form-checkbox>
            <b-form-checkbox switch size="lg" v-if="!email_confirmed" disabled>
              Notify when device is online again</b-form-checkbox>
          </b-col>
          
        </b-form-row>
        </b-card>
      </b-collapse>

      
      <div class="alert-bottom">
        <b-alert variant="success" :show="bottom_alert" @dismiss-count-down="alert_count_down" dismissible fade>
        {{ bottom_text }}</b-alert>
        <div class="savebtn" v-if="form_dirty">
          <b-button type="submit" variant="primary" @click="saveClick">Save settings</b-button>
          <b-button type="reset" variant="secondary">Cancel</b-button>
        </div>
      </div>

      <b-modal id="modal-email-verification" ref="modal" title="Email verification" @show="sendCode" @hidden="resetModal"@ok="handleOk">
        <form ref="form" @submit.stop.prevent="modalSubmit" autocomplete="off">
          <b-form-group label="Enter the verification code sent to your email" invalid-feedback="Incorrect code" :state="vcode_state">
            <b-form-input v-model="vcode" :state="vcode_state" required></b-form-input>
          </b-form-group>
        </form>
      </b-modal>

      </b-form>
      </b-container>
      
      <downtime-chart :events="device_cached.events"></downtime-chart>
      <h3>Downtimes list</h3>
      <downtime-table :device="device_cached" :edit="device.edit_token"></downtime-table>
      <a href="" @click.prevent="deleteDevice" class="dellink">Delete device</a>
    </div>`,
  data() {
    return {
      device: {},
      device_cached: {},
      editable: {reset: true},
      editable_initial: '',
      configured_email: '',
      email_show_confirm: false,
      email_confirmed: false,
      email_incorrect: false,
      update_url: null,
      edit_url: null,
      view_url: null,
      bottom_alert: false,
      bottom_text: '',
      show_instructions: false,
      show_settings: false,
      show_notifications: false,
      show_settings_l: false,
      show_notifications_l: false,
      qrcode: null,
      vcode: '',
      vcode_state: null
    }
  },
  methods: {
    async refresh() {
      this.device = await request("/u/e/" + this.$route.params.token)
      prepare_device.apply(this)
      document.title = `${this.device.title} - manage - ${APP_TITLE}`
      
      this.update_url = APP_URL.replace('https://', 'http://') + '/u/' + this.device.update_token
      this.edit_url = APP_URL + '/e/' + this.device.edit_token
      this.view_url = APP_URL + '/v/' + this.device.view_token

      if (this.editable.reset) {
        this.resetEditable()
      }
      this.emailChange()
      loaded()
    },
    resetEditable() {
      this.email_confirmed = this.device.email_confirmed
      if (this.device.email_confirmed) {
        this.configured_email = this.device.email
      }
      if (!this.device.updated) {
        this.show_instructions = this.show_settings = this.show_notifications = true
      }

      const editableKeys = ['title', 'notes', 'location', 'isp', 'battery', 'reserve', 
      'battery_comment', 'reserve_comment', 'public', 'interval', 'notify_interval',  'email',  'notifyoff', 'notifyon'];
      this.editable = editableKeys.reduce((obj, key) => ({ ...obj, [key]: this.device[key] }), {});
      this.editable_initial = JSON.stringify(this.editable)
    },
    confirmLeave() {
      return window.confirm('Do you really want to leave? you have unsaved changes!')
    },
    confirmStayInDirtyForm() {
      return this.editable_initial && this.form_dirty && !this.confirmLeave()
    },
    beforeWindowUnload(e) {
      if (this.confirmStayInDirtyForm()) {
        e.preventDefault()
        e.returnValue = ''
      }   
    },
    saveClick() {
      this.show_settings_l = this.show_settings
      this.show_notifications_l = this.show_notifications
      this.show_settings = this.show_notifications = true
    },
    async onSubmit() {
      this.show_settings = this.show_settings_l
      this.show_notifications = this.show_notifications_l
      var res = await request("/u/e/" + this.$route.params.token, this.editable)
      if (res.ok) {
        this.editable.reset = true
        this.refresh()
        this.bottom_alert = 5
        this.bottom_text = 'Saved'
      }
      this.emailChange()
    },
    onReset() {
      this.editable = JSON.parse(this.editable_initial)
      this.emailChange()
    },
    emailChange() {
      this.email_incorrect = false
      this.email_show_confirm = false
      this.email_confirmed = false
      if (!this.editable.email) { return }
      if (this.editable.email == this.configured_email) {
        this.email_confirmed = true
      } else {
        if (this.$refs['eml'].checkValidity()) {
          this.email_show_confirm = true
        } else {
          this.email_incorrect = true
        }
      }
    },
    alert_count_down(dismissCountDown) {
      this.bottom_alert = dismissCountDown
    },
    copyToClipboard(ev) {
      ev.target.focus()
      ev.target.select()
      try {
        document.execCommand('copy')
        this.bottom_alert = 5
        this.bottom_text = 'Copied to clipboard'
      } catch {}
    },
    async checkEmailCode() {
      if (!this.$refs.form.checkValidity()) { 
        this.vcode_state = false
        return false 
      }
      var res = await request("/u/verify_email/" + this.$route.params.token, {vcode: this.vcode})
      this.vcode_state = res.ok
      if (res.ok) {
        this.bottom_alert = 5
        this.bottom_text = 'Your email has been successfully verified'
        this.vcode_state = true
        this.configured_email = this.editable.email
        this.emailChange()
      } else {
        if (res.blocked) {
          this.bottom_alert = 300
          this.bottom_text = 'You have entered the wrong code too many times. Please try again after 24 hours'
          this.vcode_state = true
        } else {
          this.bottom_alert = 5
          this.bottom_text =  'Incorrect code'
          this.vcode_state = false
        }
      }
      return this.vcode_state
    },
    resetModal() {
      this.vcode = ''
      this.vcode_state = null
    },
    async sendCode() {
      this.resetModal()
      var res = await request("/u/email_send_code/" + this.$route.params.token, {email: this.editable.email})
      if (res.ok) {
        this.bottom_alert = 5
        this.bottom_text = 'A verification code has been sent to your email'
      } else {
        this.bottom_alert = 300
        this.bottom_text = 'Failed to send code. Please try again after 24 hours'
        this.$nextTick(() => {
          this.$bvModal.hide('modal-email-verification')
        })
      }
    },
    handleOk(bvModalEvent) {
      bvModalEvent.preventDefault()
      this.modalSubmit()
    },
    async modalSubmit() {
      if (! await this.checkEmailCode()) {
        return
      }
      this.$nextTick(() => {
        this.$bvModal.hide('modal-email-verification')
      })
    },
    async changeToken(tok) {
      if (!confirm(`Are you sure to change ${tok} url for ${this.device.title}?`)) { return }
      var res = await request("/u/change_token/" + this.$route.params.token, {tok: tok})
      if (tok == 'edit' && res.ok) {
        router.push('/e/'+ res.new_token)
      } else {
        this.refresh()
      }
    },
    async deleteDevice() {
      if (!confirm(`Are you sure to delete ${this.device.title}? It's no going back.`)) { return }
      var res = await request("/u/delete_device/" + this.$route.params.token, {ok: true})
      if (res.ok) {
        app.logosClick()
      }
    },
    async start() {
      this.refresh()
      ws_start(this.$route.params.token, this.refresh)
    }
  },
  computed: {
    form_dirty() {
      return this.editable_initial != JSON.stringify(this.editable)
    },
    ssh_command() {
      const domain = APP_URL.match(/\/([a-zA-Z0-9-.]+)/)[1]
      const u = this.update_url
      return `sed -i '/${domain}/d' /etc/crontab; `+
        `echo '* * * * * root curl ${u} || wget ${u}' >> /etc/crontab`
    },
    macro_link() {
      return APP_URL + '/u/uptime.macro?url=' + this.update_url
    }
  },
  watch: {
    edit_url(url) {
      this.qrcode.clear();
      this.qrcode.makeCode(url);
    },
    $route(to, from) {
      this.start()
    }
  },
  mounted() {
    this.start()
    this.qrcode = new QRCode(document.getElementById("qrcode"), {width: 100, height: 100})
  },
  beforeRouteLeave(to, from, next) {
    if (this.confirmStayInDirtyForm()){
      next(false)
    } else {
      next()
    }
  },
  created() {
    window.addEventListener('beforeunload', this.beforeWindowUnload)
  },
  beforeDestroy() {
    window.removeEventListener('beforeunload', this.beforeWindowUnload)
  }
}

const NotFoundComponent = {
  template: `<div>
    <h3>Not found</h3>
  </div>`,
  mounted() {
    loaded()
  }
}

const Register = { 
  template: `<div>
    <b-container>
      <p>{{ message }}</p>
    </b-container>
  </div>`,
  data() {
    return {
      message: ''
    }
  },
  async mounted() {
    var res = await request("/u/create_device", {ok: true})
    if (res.ok) {
      router.push('/e/'+ res.new_token)
    }
    if (res.blocked) {
      this.message = 'Too many registrations from your ip address. Please try again after 24 hours'
      loaded()
    }
  }
}