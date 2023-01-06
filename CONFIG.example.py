# Main config file
# Rename this file to CONFIG.py


# SECTION A
# These variables are used in setup.sh and blackouts.py, you need to run setup.sh atfer editing this section

# To obtain TLS certificate automatically, change the option below to 1, and set the correct domain name

USE_LETSENCRYPT=0
DOMAIN="blackouts.example.com"
EMAIL="example@example.com"

# If you don't want to use a domain name. The app will be available on http://YOUR_IP:18000
NGINXOPT="listen 18000 default_server;"

# Name for systemd unit and nginx site config
APPNAME="blackouts"

# Listen unix socket
SANIC_SOCKET="unix:/tmp/blackouts.sanic"

# Listen tcp port 8000, localhost only
#SANIC_SOCKET="127.0.0.1:8000"

# Allow direct connections from the network
# If you don't use proxying, uncomment the line bellow and adjust app_url in public/index.html
#SANIC_SOCKET="0.0.0.0:8000"

# Will be written to nginx site config
FORWARDED_SECRET="ChangeMe"

# Database name
DBNAME="blackouts"





# SECTION B
# These variables are used in blackouts.py only, you need to run `sudo systemctl restart $APPNAME` atfer editing this section
# Also, some variables need to be configured in public/index.html

# By default, use a database named blackouts on the local postgresql server
# Connect via unix socket, auth with ident protocol (without password)
SQLALCHEMY_URL="postgresql+asyncpg:///blackouts?host=/var/run/postgresql"
# Tables will be created automatically on first run
# The string form of the URL is dialect[+driver]://user:password@host/dbname[?key=value..]
#SQLALCHEMY_URL="postgresql://ubuntu:password@localhost/blackouts"

# We dont't need crap like Same-origin policy is this app
# This allows you to place the frontend anywhere, even on the local file system
ALLOW_ORIGIN = "*"

# Min value for update interval and notify down interval
MIN_INTERVAL=60
# Max value for update interval and notify down interval
MAX_INTERVAL=3600
# Downtime will be written if device was down interval * BLACKOUT_COEFFICIENT
BLACKOUT_COEFFICIENT=2.5
# Default value for update interval
DEFAULT_INTERVAL=60
# Send no more emails with a code per day, per device
EMAIL_MAX_SENT=3
# Max number of failed code entry attempts
EMAIL_VCODE_ATTEMPT=6
# Max registrations from same ip per day
REG_PER_IP=5
# Websocket timeout (seconds, server side)
WEBSOCKET_TIMEOUT=50
# Refresh the home page no more than (seconds)
ASTERISK_MIN_TIME=5

MAILER_TLS=True
MAILER_SERVER="smtp.example.com"
MAILER_USERNAME="example@example.com"
MAILER_PASSWORD="ExamplePassword"
MAILER_EMAIL="Blackouts at Example <example@example.com>"
MAILER_URL="https://blackouts.example.com"
#MAILER_URL="http://example.com/#"
# Directly to api - make sure the unsubscribe link is working properly
MAILER_UNSUBSCRIBE="https://blackouts.example.com/u/unsubscribe/"
