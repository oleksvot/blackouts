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



from email.message import EmailMessage
import aiosmtplib

from CONFIG import *

async def send_smtp(message):
	await aiosmtplib.send(message, hostname=MAILER_SERVER, username=MAILER_USERNAME, 
		password=MAILER_PASSWORD, use_tls=MAILER_TLS)

async def send_message(email, subject, content):
	message = EmailMessage()
	message["From"] = MAILER_EMAIL
	message["To"] = email
	message["Subject"] = subject
	message.add_header('Content-Type', 'text/html')
	message.set_payload(content)
	await send_smtp(message)

def footer(email, edit_token):
	return (f'<br><br><big><a href="{MAILER_URL}/e/{edit_token}">Change settings</a></big><br><br><br>' +
	f'<small>You received this message because you have enabled notifications at {DOMAIN}. If you do not want to receive '+
	f'these messages in the future, please <a href="{MAILER_UNSUBSCRIBE}{edit_token}">unsubscribe</a></small>')

async def device_down(email, title, edit_token):
	print('MAILER - DEVICE DOWN', email, title)
	await send_message(email, f"{title} is down", f"<h1>{title} is down</h1>" + footer(email, edit_token))

async def device_up(email, title, edit_token):
	print('MAILER - DEVICE UP', email, title)
	await send_message(email, f"{title} is online", f"<h1>{title} is online</h1>" + footer(email, edit_token))

async def device_vcode(email, email_vcode, title, view_token, edit_token):
	print('MAILER - VCODE', email, title)
	await send_message(email, f"{title} - welcome to {DOMAIN}", f"<big>Verification code: <b>{email_vcode}</b></big><br><br>" +
		f"Please save this message.<br>Permanent link to your device settings page:<br>"+
		f"{MAILER_URL}/e/{edit_token}<br><br>"+
		f"Your monitoring page (view-only):<br>"+
		f"{MAILER_URL}/v/{view_token}<br><br><br>"+
		f"<small>If you have not registered on our site, just ignore this message</small>")

