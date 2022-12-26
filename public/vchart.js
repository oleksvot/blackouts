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

Vue.component('downtime-chart', {
  props: ['events'],
  template: `<div class="vchart"><div class="chart"><canvas id="myChart"></canvas></div></div>`,
  watch: {
    events (events) {
      // Assumes events is sorted by datetime
      var xAxes = []
      var datasets = []

      // If we have more than one event in day, we want to display several bars
      // We can't do it easy with this chart.js version, so we need some manipulations with datasets
      var addDataset = (yellow=false) => {
        var data = []
        for (var nday = 0; nday < days.length; nday ++) {
          data.push([0, 0])
        }
        datasets.push({
          label: 'down hours',
          data: data,
          backgroundColor: yellow ? 'rgba(255, 206, 86, 0.2)' : 'rgba(255, 99, 132, 0.2)',
          borderColor: yellow ? 'rgba(255, 206, 86, 1)' : 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
          yellow: yellow
        })
        if (xAxes.length) {
          xAxes.push({
              stacked: true,
              display: false
          })
        } else {
          xAxes.push({
              stacked: true,
              position: 'top'
          })
        }
      }

      
      // Start from device creation date at 00:00:00 o'clock in local timezone
      var current = new Date(events[0].ended)
      current.setHours(0)
      current.setMinutes(0)
      current.setSeconds(0)
      // Carry flag - if was offline on midnight
      var night = false
      // Event index
      var n = 1
      // Current date time
      var now = new Date()
      // [day_number] date in locale format
      var days = []
      // [day_number][event_number][0: start_hour, 1: end_hour, 2: is_crossed]
      var all_ranges = []
      // [day_number] tooltip text
      var downtimes_texts = []
      while (current <= now) {
        var tomorrow = new Date(+current + 86400000)
        var downtime = 0
        var downtime_excluded = 0
        var ranges = []

        while (events[n]) {
          // We don't want events about ip change here
          if (events[n].downtime) {
            var started = new Date(events[n].started)
            var ended = new Date(events[n].ended)
            // End of the day reached, push data
            if (started >= tomorrow) { break }
            // Started at 0 o'clock
            if (night) { started = current }
            if (ended > tomorrow) {
              night = true
              if (!events[n].crossed) {
                downtime += tomorrow - started
              } else {
                downtime_excluded += tomorrow - started
              }
              // Ended at 24 o'clock
              ranges.push([started.getHours() + started.getMinutes() / 60, 24, events[n].crossed])

              
              break
            } else {
              night = false
              if (!events[n].crossed) {
                downtime += ended - started
              } else {
                downtime_excluded += ended - started
              }
              ranges.push([started.getHours() + started.getMinutes() / 60, 
                ended.getHours() + ended.getMinutes() / 60, events[n].crossed])
              
            }
          }
          n ++
        }
        // Push data for this day
        days.push(current.toLocaleDateString())
        all_ranges.push(ranges)
        var ltext = ` ${formatSeconds(downtime / 1000)} down`
        if (downtime_excluded ) {
          ltext += ` ( + ${ formatSeconds(downtime_excluded / 1000)} excluded)`
        }
        downtimes_texts.push(ltext)
        current = tomorrow
      }

      // Now all data are in all_ranges
      // But we must turn it inside out
      // First we add red bars, then yellow ones
      for (var yellow = 0; yellow < 2; yellow ++) {
        // We need this so as not to mix up the colors
        var base_nevent = datasets.length
        for (var nday = 0; nday < days.length; nday ++) {
          // Dataset index. Starts from 0 for red bars
          var mevent = base_nevent
          for (var nevent = 0; nevent < all_ranges[nday].length; nevent ++) {
            // Yeah, null != 0, but false == 0
            if (Boolean(all_ranges[nday][nevent][2]) != yellow) { continue }
            
            if (mevent >= datasets.length) {
              // We need new dataset here. It will be initialized with zeros, so bars are not displayed if we don't change it
              addDataset(yellow)
            }
            datasets[mevent].data[nday] = [all_ranges[nday][nevent][0], all_ranges[nday][nevent][1]]
            mevent ++
          }
        }
      }
      
      document.getElementsByClassName('chart')[0].style.width = (100 + days.length * 30) + 'px'

      var ctx = document.getElementById('myChart').getContext('2d');
      // Yeah, it will be boring without global variables and ignored exceptions
      try {myChart.destroy()} catch{}
      myChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: days,
          datasets: datasets
        },
        options: {
          maintainAspectRatio: false,
          legend: {
            display: false
          },
          scales: {
              xAxes: xAxes,
              yAxes: [{
                ticks: {
                  min: 0,
                  max: 24,
                  stepSize: 3,
                  reverse: true
                },
                scaleLabel: {
                  display: true,
                  labelString: 'Timeline'
                }
              }]
          },
          tooltips: {
            callbacks: {
              label: function(tooltipItem, data) {
                
                return downtimes_texts[tooltipItem.index];
              }
            }
          }
        }
      });
    }
  },
})