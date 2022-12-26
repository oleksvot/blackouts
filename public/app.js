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

Vue.component('welcome', {
  template: `<div class="welcome">
    <p>
      Monitor the stability of your Internet connection and prove it to your counterparties.<br>
      Receive outage notifications.
    </p>
    <router-link to="/register">
      <b-button variant="primary" size="lg" pill>Register device</b-button>
    </router-link>
    <router-link to="/" v-if="$route.path != '/'">
      <b-button variant="secondary" size="lg" pill>Device list</b-button>
    </router-link>
  </div>`
})


Vue.component('device-row', {
  props: ['device'],
  mixins: [deviceMixin],
  template: `<b-row>
    <b-col>
      <b-icon-person-fill></b-icon-person-fill> {{ device.title }} 
    </b-col>
    <b-col class="nowrap bulbrow">
      <b-button variant="success" size="sm" :title="uptimeTitle">{{ uptimeUncrossed }}%</b-button>
      <b-button variant="secondary" size="sm" v-if="isCorrected" :title="uptimeRealTitle">{{ uptimeCrossed }}%</b-button>
      <img :src="bulbSrc" class="sbulb">
    </b-col>
    <b-col lg class="noident">
      <span v-if="! alive" class="downtime">{{ downtime }} down</span>
    </b-col>
    <b-col lg><b-icon-geo-alt-fill></b-icon-geo-alt-fill> {{ device.location }}</b-col>
    <b-col lg><b-icon-wifi></b-icon-wifi> {{ device.isp }}</b-col>
  </b-row>`
})


// Index page
const Index = {
  template: `<div>
    <welcome></welcome>
    <b-container class="listing">
    <router-link :to="'/v/' + device.id" v-for="device in listing.devices" :key="device.id">
    <device-row :device="device"></device-row>
    </router-link>
    <p><small>{{ listing.total }} devices registered</small></p>
    </b-container>
    </div>`,
  data() {
    return {
      listing: {}
    }
  },
  methods: {
    async refresh() {
      this.listing = await request("/u/listing")
      loaded()
    }
  },
  mounted() {
    this.refresh()
    ws_start('*', this.refresh)
  }
}


// /v/<view_token or id for public devices>
const DeviceView = {
  template: `<div>
      <b-container>
      <b-row class="deviceinfo">
        <b-col lg>
          <b-icon-person-fill></b-icon-person-fill> {{ device.title }} 
        </b-col>
        <b-col lg title="Location"><b-icon-geo-alt-fill></b-icon-geo-alt-fill> {{ device.location }}</b-col>
        <b-col lg title="ISP"><b-icon-wifi></b-icon-wifi> {{ device.isp }}</b-col>
      </b-row>
      <b-row class="deviceinfo">
        <b-col lg>
          <b-iconstack font-scale="2">
            <b-icon-battery-full stacked></b-icon-battery-full>
            <b-icon-slash-lg v-if="!device.battery" variant="danger" stacked></b-icon-slash-lg>
          </b-iconstack>
          {{ device.battery_comment ? device.battery_comment : ((device.battery ? 'Have' : 'No') + ' battery') }}
        </b-col>
         <b-col lg>
          <b-iconstack font-scale="2">
            <b-icon-reception3 stacked></b-icon-reception3>
            <b-icon-slash-lg v-if="!device.reserve" variant="danger" stacked></b-icon-slash-lg>
          </b-iconstack>
          {{ device.reserve_comment ? device.reserve_comment : ((device.reserve ? 'Have' : 'No') + 
            ' reserve connection') }}
        </b-col>
      </b-row>
      <plaintext>{{ device.notes }}</plaintext>
      <hr>
      <device-info :device="device"></device-info>
      </b-container>
      <downtime-chart :events="device_cached.events"></downtime-chart>
      <h3>Downtimes list</h3>
      <downtime-table :device="device_cached"></downtime-table>
      <welcome></welcome>
    </div>`,
  data() {
    return {
      device: {},
      device_cached: {},
    }
  },
  methods: {
    async refresh() {
      this.device = await request("/u/v/" + this.$route.params.token)
      prepare_device.apply(this)
      document.title = `${this.device.title} - ${APP_TITLE}`
      loaded()
    }
  },
  mounted() {
    this.refresh()
    ws_start(this.$route.params.token, this.refresh)
  }
}



const routes = [
  { path: '/', component: Index },
  { path: '/register', component: Register },
  { path: '/e/:token', component: DeviceEdit },
  { path: '/v/:token', component: DeviceView },
  { path: '*', component: NotFoundComponent }
]

const router = new VueRouter({
  routes, mode: ROUTER_MODE
})

router.beforeResolve((to, from, next) => {
  loading()
  next()
})

router.afterEach((to, from) => {
  try {
    app.bigBulb = true
    document.title = APP_TITLE
    fetch("https://homserv.net/a/v", {method: 'POST', body: `${location.href}\n${document.referrer}`})
  } catch {

  }
})

const app = new Vue({
  router,
  data: {
    bigBulb: true,
    server_error: null
  },
  watch: {
    bigBulb (bul) {
      document.getElementById("favicon").href = this.bigBulbSrc
    },
  },
  computed: {
    bigBulbSrc () {
      return 'img/' + (this.bigBulb ? 'on' : 'off' ) +'.png'
    },
    timezone () {
      var tz_offset = -(new Date().getTimezoneOffset())
      return 'UTC' + (tz_offset >= 0 ? '+' : '') + Math.floor(tz_offset / 60) + 
        (tz_offset % 60 ? ':' + tz_offset % 60 : '')
    }
  },
  methods: {
    logosClick() {
      router.push('/')
    }
  }
}).$mount('#app')