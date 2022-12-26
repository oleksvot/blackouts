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

from sanic import Sanic, Request, Websocket
from sanic.response import text, json
from sanic_ext import Extend
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy import Column, Integer, BigInteger, String, Text, Float, DateTime, Boolean, Enum, ForeignKey
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.exc import PendingRollbackError
from geoip import geolite2
from datetime import datetime, timezone, timedelta
from ipaddress import IPv4Address
from random import SystemRandom
import string
import time
import asyncio
import re
import traceback

from CONFIG import *
import mailer

random = SystemRandom()

app = Sanic(APPNAME)
app.config.FORWARDED_SECRET = FORWARDED_SECRET
app.config.CORS_ORIGINS = ALLOW_ORIGIN
app.config.CORS_AUTOMATIC_OPTIONS = True
Extend(app)

engine = create_async_engine(SQLALCHEMY_URL)
Base = declarative_base()
async_orm = sessionmaker(engine, class_=AsyncSession)

class Device(Base):
    __tablename__ = "device"
    id = Column(Integer, primary_key=True)
    title = Column(String(30), default='Untitled device')
    notes = Column(Text, default='')
    country = Column(String(2), default='')
    location = Column(String(100), default='')
    isp = Column(String(50), default='')
    battery = Column(Boolean, default=False)
    reserve = Column(Boolean, default=False)
    battery_comment = Column(String(100), default='')
    reserve_comment = Column(String(100), default='')
    # Public device - show on the main page
    public = Column(Boolean, index=True, default=False)
    # Update interval (seconds). Downtime will be written if device was down interval * BLACKOUT_COEFFICIENT
    interval = Column(Integer, default=DEFAULT_INTERVAL)
    # Interval for down notifications (seconds). Used in alerts_down
    notify_interval = Column(Integer, default=int(DEFAULT_INTERVAL * BLACKOUT_COEFFICIENT))
    email = Column(String(255), default='')
    # The number of sent letters. Used with EMAIL_MAX_SENT
    email_count = Column(Integer, default=0)
    # The date on which the first unconfirmed email was sent. Reset email_count after 24 hours.
    email_sent = Column(DateTime)
    # Email confirmation code
    email_vcode = Column(String(6))
    # Number of wrong code entries. Used with EMAIL_VCODE_ATTEMPT
    email_errors = Column(Integer, default=0)
    # True if email is confirmed. Should be reset when changing email
    email_confirmed = Column(Boolean, default=False)
    # Notify when device is down
    notifyoff = Column(Boolean, index=True, default=False)
    # Notify when device is down
    notifyon = Column(Boolean, default=False)
    # Device creation (first update) date time
    created = Column(DateTime, index=True)
    edit_token = Column(String(20), index=True)
    view_token = Column(String(20), index=True)
    update_token = Column(String(20), index=True)
    ip = Column(String(39), index=True)
    # Last update
    updated = Column(DateTime, index=True)
    # Real downtime
    downtime = Column(Integer, index=True, default=0)
    # Corrected downtime (changed by toogle_event)
    downtime_uncrossed = Column(Integer, default=0)
    # Used for cache reset on front
    version = Column(Integer, default=0)
    # Set when down email is sent, reset on next update
    notified_down = Column(Boolean, default=False)
    events = relationship("Event", back_populates="device")

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True)
    # First event has no started
    started = Column(DateTime)
    ended = Column(DateTime)
    # Events about ip change only has no downtime
    downtime = Column(Integer)
    # First event has no old_ip
    old_ip = Column(String(39))
    new_ip = Column(String(39))
    # User comment
    comment = Column(String(150))
    # Excluded by user
    crossed = Column(Boolean, default=False)
    device_id = Column(Integer, ForeignKey("device.id"))
    device = relationship("Device", back_populates="events")

class IPs(Base):
    __tablename__ = "ips"

    id = Column(Integer, primary_key=True)
    # IP range - min
    a = Column(BigInteger, index=True)
    # IP range - max
    b = Column(BigInteger, index=True)
    isp = Column(String(50))
    location = Column(String(100))

@app.listener("before_server_start")
async def initialize(app, loop):
    '''
    Create tables and start alerts_loop
    '''
    async with engine.begin() as db:
        await db.run_sync(Base.metadata.create_all)

    asyncio.create_task(alerts_loop())


async def alerts_loop():
    '''
    Email down devices
    '''
    while True:
        asyncio.create_task(alerts_down())
        await asyncio.sleep(MIN_INTERVAL)

async def alerts_down():
    '''
    Email down devices
    '''
    async with async_orm() as orm:
        now = datetime.utcnow()
        rs = await orm.execute(select(Device).filter_by(notifyoff=True, email_confirmed=True, notified_down=False).where(
            Device.updated < now - timedelta(seconds=MIN_INTERVAL),
            Device.updated > now - timedelta(seconds=MAX_INTERVAL + MIN_INTERVAL * 2)))
        for device in rs.scalars():
            try:
                if device.updated < now - timedelta(seconds=device.notify_interval):
                    asyncio.create_task(mailer.device_down(device.email, device.title, device.edit_token))
                    device.notified_down = True
            except:
                traceback.print_exc()
        await orm.commit()

def random_str(l=20):
    return ''.join( [ random.choice(string.ascii_lowercase) for _ in range(20) ] )

def validate_email(email):
    if re.fullmatch(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\b', email):
        return True
    else:
        raise ValueError('Incorrect email')

def json_serial(obj):
    '''
    json.dumps helper. Use iso format for datetime. In the database, the time is stored without a time zone, assumes UTC
    '''
    if isinstance(obj, datetime):
        return obj.replace(tzinfo=timezone.utc).isoformat()
    raise TypeError ("Type %s not serializable" % type(obj))

@app.get("/u/listing")
async def listing(request):
    '''
    /u/listing - public device listing for main page
    '''
    async with async_orm() as orm:
        columns = ('id', 'title', 'isp', 'location', 'created', 'updated', 'downtime', 'downtime_uncrossed', 'interval')
        devices = (await orm.execute(select(Device).filter_by(public=True).order_by(Device.downtime))).scalars()
        return json({'devices': [ { k: device.__dict__[k] for k in columns } for device in devices ], 
            'total': (await orm.execute(select([func.count()]).select_from(Device))).scalar_one()
            }, default=json_serial)

async def mask_ip(ip):
    '''
    Removes last octet from ip address. Search for isp, location and country
    '''
    if not ip: return None

    async with async_orm() as orm:
        ip_int = int(IPv4Address(ip))
        ip_info = (await orm.execute(select(IPs).filter(IPs.a <= ip_int, IPs.b >= ip_int))).scalars().first()
        ipc = ip.split('.')
        ipc[3] = '*'
        try:
            country = geolite2.lookup(ip).country
            country_a = f", {country}" if ip_info and ip_info.location else country
            country_b = f" ({country})"
        except:
            country_a = country_b = ''
        return '.'.join(ipc) + (f" ({ip_info.isp}, {ip_info.location}{country_a})" if ip_info else country_b)
    


async def get_device_js(device, columns):
    '''
    Prepare response for edit and view pages
    '''
    async with async_orm() as orm:
        js = { k: await mask_ip(device.__dict__[k]) if k == 'ip' else device.__dict__[k] for k in columns }
        events = (await orm.execute(select(Event).filter_by(device_id=device.id))).scalars()
        ecolumns = ('id', 'started', 'ended', 'downtime', 'old_ip', 'new_ip', 'comment', 'crossed')
        js['events'] = []
        for event in events:
            js['events'].append({ k: await mask_ip(event.__dict__[k]) if k.endswith('_ip') else event.__dict__[k] for k in ecolumns })
        return js

@app.get("/u/v/<token>")
async def device_view(request, token):
    '''
    /u/v/<view_token or id for public devices> - device info and events list
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(view_token=token))).scalar_one()
        except:
            try:
                device = (await orm.execute(select(Device).filter_by(id=int(token)).filter_by(public=True))).scalar_one()
            except:
                return json({'error': 'bad token'})
        
        columns = ('id', 'title', 'notes', 'country', 'location', 'isp', 'battery', 'reserve', 
            'battery_comment', 'reserve_comment', 'interval', 'created', 'ip', 'updated', 'downtime', 'downtime_uncrossed', 'version')

        return json(await get_device_js(device, columns), default=json_serial)

@app.get("/u/e/<token>")
async def device_edit(request, token):
    '''
    /u/e/<edit_token> - device info for admin and events list
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})
        
        columns = ('id', 'title', 'notes', 'country', 'location', 'isp', 'battery', 'reserve', 'battery_comment', 
            'reserve_comment', 'public', 'interval', 'notify_interval',  'email', 'email_confirmed',  'notifyoff', 'notifyon', 
            'created', 'edit_token', 'view_token', 'update_token', 'ip', 'updated', 'downtime', 'downtime_uncrossed', 'version')

        return json(await get_device_js(device, columns), default=json_serial)

@app.post("/u/e/<token>")
async def device_save(request, token):
    '''
    Saves editable fields to device table. If email changed, marks it as unconfirmed
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        editable_columns = ['title', 'notes', 'location', 'isp', 'battery', 'reserve', 
          'battery_comment', 'reserve_comment', 'public', 'interval', 'notify_interval',  'email',  'notifyoff', 'notifyon']

        rj = request.json
        for col in editable_columns:
            if col in rj:
                val = rj[col]
                if col == 'email':
                    if device.email != val:
                        device.email_confirmed = False
                    if val:
                        validate_email(val)
                if col.endswith('interval'):
                    if val < MIN_INTERVAL or val > MAX_INTERVAL: return json({'alert': 'incorrect interval'})
                setattr(device, col, val)

        notify_device(device)
        await orm.commit()

        return json({'ok': True})


@app.post("/u/email_send_code/<token>")
async def email_send_code(request, token):
    '''
    Saves email to device table and sends verification code. post - email
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        rj = request.json
        
        device.email = rj['email']
        device.email_confirmed = False

        now = datetime.utcnow()

        if not device.email_sent or device.email_sent < now - timedelta(days=1):
            device.email_sent = now
            device.email_count = 0
            device.email_errors = 0

        if device.email_count >= EMAIL_MAX_SENT or device.email_errors >= EMAIL_VCODE_ATTEMPT:
            return json({'blocked': True})
        
        device.email_vcode = str(random.randrange(100000, 999999))
        device.email_count += 1

        asyncio.create_task(mailer.device_vcode(device.email, device.email_vcode, device.title, device.view_token, device.edit_token))

        await orm.commit()

        return json({'ok': True})

@app.post("/u/verify_email/<token>")
async def verify_email(request, token):
    '''
    Checks email verification code, sets email_confirmed. post - vcode
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        rj = request.json
        
        if device.email_errors >= EMAIL_VCODE_ATTEMPT:
             return json({'blocked': True})
        
        if device.email_vcode == rj['vcode']:
            device.email_confirmed = True
            js = {'ok': True}
        else:
            device.email_errors += 1
            js = {'error': True}

        await orm.commit()

        return json(js)

async def set_token(device, tok):
    '''
    Generates token and saves it to device object. tok - ('edit', 'view', 'update')
    '''
    async with async_orm() as orm:
        if tok not in ('edit', 'view', 'update'): raise NameError('Incorrect tok')
        tok = tok + '_token'
        val = random_str()
        if (await orm.execute(select(Device).filter(getattr(Device, tok) == val))).scalars().first():
            raise ValueError('Collision')

        setattr(device, tok, val)
        return val

@app.post("/u/change_token/<token>")
async def change_token(request, token):
    '''
    Generates token and saves it to device table. post - tok
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        rj = request.json
        tok = rj['tok']
        new_token = await set_token(device, tok)
        notify_device(device)
        await orm.commit()
        return json({'ok': True, 'new_token': new_token})

@app.get("/u/unsubscribe/<token>")
async def unsubscribe(request, token):
    '''
    Unsubscribe email
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        device.email = ''
        device.email_confirmed = False
        res = 'You have successfully unsubscribed from notifications about ' + device.title
        await orm.commit()
        return text(res)

@app.post("/u/toogle_event/<token>")
async def toogle_event(request, token):
    '''
    Toogle event crossed state and update downtime_uncrossed. post - id
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        rj = request.json
        event = (await orm.execute(select(Event).filter_by(id=int(rj['id'])).filter_by(device_id=device.id))).scalar_one()
        event.crossed = not event.crossed
        device.downtime_uncrossed += event.downtime * (-1 if event.crossed else 1)
        notify_device(device)
        await orm.commit()
        return json({'ok': True})

@app.post("/u/add_comment/<token>")
async def add_comment(request, token):
    '''
    Add comment to event. post - id, comment
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        rj = request.json
        event = (await orm.execute(select(Event).filter_by(id=int(rj['id'])).filter_by(device_id=device.id))).scalar_one()
        event.comment = rj['comment']
        notify_device(device)
        device.version += 1 
        await orm.commit()
        return json({'ok': True})

@app.post("/u/create_device")
async def create_device(request):
    '''
    Create new device
    '''
    async with async_orm() as orm:
        now = datetime.utcnow()
        yesterday = now - timedelta(days=1)
        if (await orm.execute(select([func.count()]).select_from(Device).where(
            Device.ip == request.remote_addr, Device.created > yesterday))).scalar_one() > REG_PER_IP:
            return json({'blocked': True})

        device = Device()
        for tok in ('view', 'update', 'edit'):
            token = await set_token(device, tok)

    
        device.created = now

        device.ip = request.remote_addr
        try:
            device.country = geolite2.lookup(device.ip).country
        except:
            pass

        if device.ip:
            ip_int = int(IPv4Address(device.ip))
            ip_info = (await orm.execute(select(IPs).filter(IPs.a <= ip_int, IPs.b >= ip_int))).scalars().first()
            if ip_info:
                device.isp = ip_info.isp
                device.location = ip_info.location + ' ' + device.country

        orm.add(device)
        await orm.commit()
        device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        device.title = 'Device ' + str(device.id)
        await orm.commit()
        return json({'ok': True, 'new_token': token})


@app.post("/u/delete_device/<token>")
async def delete_device(request, token):
    '''
    Deletes events from database and marks device as deleted
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(edit_token=token))).scalar_one()
        except:
            return json({'error': 'bad token'})

        
        await orm.execute(delete(Event).where(Event.device_id == device.id))
        device.edit_token = device.view_token = device.update_token = None
        device.email_confirmed = device.public = False
        await orm.commit()
        return json({'ok': True})

class ws:
    subscriptions = {}
    sockets = {}
    asterisk_timestamp = 0

@app.websocket("/u/watch")
async def watch(request: Request, wsocket: Websocket):
    '''
    /u/watch - WebSocket handler
        Incoming message for creating / updating subscription: 
            resource_id@client_key

            resource_id - may be device id, edit/view token, or * for all public devices
            client_key - random string 20 characters long
            
            Only one subscription is allowed per socket
            Only one socket is allowed per client_key

        Any incoming messages without the @ symbol is treated as a keepalive

        If no message has been received from the client within 50 seconds (WEBSOCKET_TIMEOUT), 
        the socket is considered stale and will be purged when notify is called

        Outgoing message:
            .              for successful subscription or keepalive
            refresh        device(s) is updated

    '''
    target = None
    key = None
    async for msg in wsocket:
        if len(msg) > 50:
            wsocket.close()
            continue

        if '@' in msg:
            target, key = msg.split('@')
            if key in ws.sockets:
                old_target = ws.sockets[key]
                del ws.subscriptions[old_target][key]
                if not ws.subscriptions[old_target]: del ws.subscriptions[old_target]

            if target not in ws.subscriptions: ws.subscriptions[target] = {}
            ws.subscriptions[target][key] = [wsocket, time.time()]
            ws.sockets[key] = target
        
        await wsocket.send('.')
        try:
            ws.subscriptions[target][key][1] = time.time()
        except:
            pass

async def notify(target):
    '''
    Finds fresh web ws.sockets that are subscribed to the given target and sends a 'refresh' message to all of them
    Cleans out stale and closed ws.sockets
    For * target, allowed only once every 5 seconds (ASTERISK_MIN_TIME)
    '''
    
    if target == '*':
        if ws.asterisk_timestamp + ASTERISK_MIN_TIME > time.time(): return
        ws.asterisk_timestamp = time.time()

    staled = []
    for key, (wsocket, t) in ws.subscriptions[target].items():
        if t + WEBSOCKET_TIMEOUT < time.time():
            staled.append(key)
        else:
            try:
                await wsocket.send('refresh')
            except:
                staled.append(key)
    for key in staled:
        del ws.subscriptions[target][key]
        if not ws.subscriptions[target]: del ws.subscriptions[target]
        del ws.sockets[key]

def notify_device(device):
    '''
    Calls notify in background for view_token and edit_token
    For public devices, also calls for device id and *
    '''
    try:
        targets = []
        if device.public:
            targets.append(device.id)
            targets.append('*')

        for token in (device.view_token, device.edit_token):
            if token: targets.append(token)

        for target in targets:
            target = str(target)
            if target not in ws.subscriptions: continue
            asyncio.create_task(notify(target))
    except:
        traceback.print_exc()

@app.get("/u/uptime.macro")
async def generate_macrodroid(request):
    '''
    /u/uptime.macro?url=<update_url>&alarm=true - Generate file for Macrodroid app
    '''
    url = request.args.get("url")
    a = 'false' if not request.args.get("alarm") or request.args.get("alarm") == 'false' else 'true'
    n = DOMAIN
    res = text('{"exportedActionBlocks":[],"isActionBlock":false,"isBeingImported":false,"isClonedInstance":false,'+
        '"isFavourite":false,"lastEditedTimestamp":1670870029810,"localVariables":[],"m_GUID":-5384050320463731281,'+
        '"m_actionList":[{"allowAnyCertificate":false,"blockNextAction":false,"m_disableUrlEncode":false,"m_httpGet":true,'+
        '"m_urlToOpen":"'+url+'","m_SIGUID":-5454013458975505420,"m_classType":'+
        '"OpenWebPageAction","m_constraintList":[],"m_isDisabled":false,"m_isOrCondition":false}],"m_category":"Uptime monitoring"'+
        ',"m_constraintList":[],"m_description":"","m_descriptionOpen":true,"m_enabled":true,"m_excludeLog":false,"m_headingColor"'+
        ':0,"m_isOrCondition":false,"m_name":"'+n+'","m_triggerList":[{"m_ignoreReferenceStartTime":false,"m_minutes":0,"m_seconds":60'+
        ',"m_startHour":0,"m_startMinute":0,"m_useAlarm":'+a+',"m_SIGUID":-7188598824216115889,"m_classType":"RegularIntervalTrigger"'+
        ',"m_constraintList":[],"m_isDisabled":false,"m_isOrCondition":false},{"m_SIGUID":-7117360536970260286,"m_classType":'+
        '"BootTrigger","m_constraintList":[],"m_isDisabled":false,"m_isOrCondition":false}]}', 
        headers={"Content-Disposition": 'Attachment; filename="uptime.macro"', "Content-Type": "application/octet-stream"})

    return res

@app.get("/u/<token>")
async def update(request, token):
    '''
    /u/<update_token> - Handles alive messages from users devices. 
    '''
    async with async_orm() as orm:
        try:
            device = (await orm.execute(select(Device).filter_by(update_token=token))).scalar_one()
        except:
            return text('bad token')

        now = datetime.utcnow()
        ip = request.remote_addr
        interval = device.interval

        try:
            device.country = geolite2.lookup(ip).country
        except:
            pass

        if not device.interval: device.interval = DEFAULT_INTERVAL
        if device.interval < MIN_INTERVAL: device.interval = MIN_INTERVAL
        

        event = Event()
        event.ended = now
        event.started = device.updated

        if device.updated:
            delta = (now - device.updated)
            # Yes, timedelta objects in python will give you a lot of fun if you expect the same behavior as in javascript.
            seconds = delta.days * 86400 + delta.seconds
            if seconds < MIN_INTERVAL / BLACKOUT_COEFFICIENT:
                return text('too often', headers={'Refresh': str(device.interval - seconds)})

            if seconds > device.interval * BLACKOUT_COEFFICIENT:
                # Write down event and increase downtime
                event.downtime = seconds
                device.downtime += seconds
                device.downtime_uncrossed += seconds

                if device.notifyon and device.email_confirmed:
                    asyncio.create_task(mailer.device_up(device.email, device.title, device.edit_token))

        else:
            # New device. Set created (registered) date time and write first event without old_ip
            device.created = now
            device.ip = None
        
        if device.ip != ip:
            event.old_ip = device.ip
            event.new_ip = ip

        if event.new_ip or event.downtime:
            event.device = device
            orm.add(event)
            device.version += 1 

        device.ip = ip
        device.updated = now

        if device.notified_down:
            device.notified_down = False

        notify_device(device)

        await orm.commit()

        try:
            ret = str(seconds)
        except:
            ret = ''
        return text(ret, headers={'Refresh': str(interval)})

async def add_ip(ip, isp, location):
    async with async_orm() as orm:
        ipc = ip.split('.')
        ipc[3] = '0'
        ip0 = '.'.join(ipc)
        ipc[3] = '255'
        ip1 = '.'.join(ipc)
        print(ip0, ip1)
        ip_int = [ int(IPv4Address(a)) for a in (ip0, ip1) ]

        ip_info = (await orm.execute(select(IPs).filter(IPs.a == ip_int[0], IPs.b == ip_int[1]))).scalars().first()
        if not ip_info:
            ip_info = IPs()
            ip_info.a = ip_int[0]
            ip_info.b = ip_int[1]

        ip_info.isp = isp
        ip_info.location = location
        orm.add(ip_info)
        await orm.commit()
    

if __name__ == '__main__':
    hp = SANIC_SOCKET.split(':')
    if hp[0] == 'unix':
        app.run(unix=hp[1], access_log=False)
    else:
        app.run(host=hp[0], port=int(hp[1]), access_log=False)