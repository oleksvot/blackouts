#!/bin/bash
# Blackouts@HomServ - uptime monitoring service for home internet connection
# Copyright (C) 2022 Oleksandr Titarenko <admin@homserv.net>
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
# 
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.


# Unattended setup script for Ubuntu Jammy
# Do not run it until you have read this file to the end and understand what changes will be made on your system
# It uses script's directory and current user ($USER) to install
# It's more about debugging convenience than security
# Must be run as a normal user (not root), with sudo access
# Before running, set the domain name, if necessary, in the CONFIG.py file
# Alternatively, the app will be available on http://YOUR_IP:18000

# Use script's directory as current
cd "$(dirname "$(realpath "$0")")";
if [ $(id -u) = 0 ] ; then echo "Please don't run as root" ; exit 1 ; fi

# Convert line endings to unix format
sed -i 's/\r$//' CONFIG.py

# Yes, it's the perfect mess. We parse the python file as a bash script
# Make sure you don't add spaces around the equal signs
source CONFIG.py

# Install/Upgrade
sudo apt update
sudo apt -y install nginx certbot python3-certbot-nginx python3-pip python3-venv postgresql

# Makes your home directory readable by other users
# This is necessary so that the files in the public directory are available to nginx
chmod a=rx,u+w $HOME

# Create a postgres role with the current username
# We use unix sockets and ident protocol, so you don't need a password to connect to the database
sudo -u postgres createuser $USER
# Create database owned by current user
sudo -u postgres createdb -O $USER $DBNAME

# Copy forwarded.conf to nginx's conf.d directory
sudo install -m a=r,u=rw -o root etc/forwarded.conf /etc/nginx/conf.d/$APPNAME.conf

# Generate nginx site config (no https)
cat <<EOF | sudo tee /etc/nginx/sites-enabled/$APPNAME
upstream $DOMAIN {
  keepalive 100;
  server $SANIC_SOCKET;
}

server {
  server_name $DOMAIN;
  listen 80;
  $NGINXOPT
  
  location / {
    root $(pwd)/public;
    try_files \$uri /index.html;
  }
  location /u/ {
    proxy_pass http://\$server_name;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_set_header forwarded "\$proxy_forwarded;secret=\"$FORWARDED_SECRET\"";
    proxy_set_header connection "upgrade";
    proxy_set_header upgrade \$http_upgrade;
  }
}
EOF

# Reload nginx configuration
sudo nginx -s reload


if [ $USE_LETSENCRYPT = 1 ]; then
# If we don't have the certificate already, obtaining it via certbot in unattended mode
sudo ls /etc/letsencrypt/live/$DOMAIN/fullchain.pem || sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL

# Generate nginx site config again (with https support)
# We don't redirect to https if called without a domain name
# Also, we don't redirect requests to the API (/u/)
# The application offers plain http links for device updates, to avoid unnecessary load
# Also add the Strict-Transport-Security header
sudo ls /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/options-ssl-nginx.conf && 
cat <<EOF | sudo tee /etc/nginx/sites-enabled/$APPNAME
upstream $DOMAIN {
  keepalive 100;
  server $SANIC_SOCKET;
}

server {
  server_name $DOMAIN;

  location / {
    root $(pwd)/public;
    try_files \$uri /index.html;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  }
  location /u/ {
    proxy_pass http://\$server_name;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_set_header forwarded "\$proxy_forwarded;secret=\"$FORWARDED_SECRET\"";
    proxy_set_header connection "upgrade";
    proxy_set_header upgrade \$http_upgrade;
  }

  listen 443 ssl; # managed by Certbot
  ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem; # managed by Certbot
  ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem; # managed by Certbot
  include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}


server {
  server_name $DOMAIN;

  location / {
    if (\$host = $DOMAIN) {
      return 301 https://\$host\$request_uri;
    }
    root $(pwd)/public;
    try_files \$uri /index.html;
  }
  location /u/ {
    proxy_pass http://\$server_name;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_set_header forwarded "\$proxy_forwarded;secret=\"$FORWARDED_SECRET\"";
    proxy_set_header connection "upgrade";
    proxy_set_header upgrade \$http_upgrade;
  }

  listen 80;
  $NGINXOPT
}

EOF

# Reload nginx configuration
sudo nginx -s reload
fi

# Create python's virtual env if it hasn't already been done, and activate it
[ ! -d env ] && python3 -m venv env
source env/bin/activate

# Install/Upgrade packages inside virtual env
pip install -r requirements.txt

# Generate systemd unit
cat <<EOF | sudo tee /etc/systemd/system/$APPNAME.service
[Unit]
Description=$APPNAME

[Service]
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/env/bin/python3 blackouts.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Activate it
sudo systemctl daemon-reload
sudo systemctl enable $APPNAME
# Use this command to restart backend
sudo systemctl restart $APPNAME

# If the nginx configuration was broken, delete the generated files
# So that you don't have great surprises after a server reboot
if ! sudo nginx -s reload; then
  echo "Error in nginx configuration, rolling back. You need to configure nginx manually."
  mv /etc/nginx/sites-enabled/$APPNAME removed-$APPNAME
  mv /etc/nginx/conf.d/$APPNAME.conf removed-$APPNAME.conf
fi
