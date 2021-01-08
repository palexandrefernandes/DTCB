const Discord = require('discord.js');
const client = new Discord.Client();
const fs = require('fs').promises;
const path = require('path');
const { ApiClient } = require('twitch');
const { ClientCredentialsAuthProvider } = require('twitch-auth');
const dotenv = require('dotenv');

dotenv.config();

const FILE = path.resolve(`${__dirname}/mem.json`);
const TIMER = 60 * 1000 * Number(process.env.TIMER);


// Commands
const CHANNEL_TRACK = '>setup';
const CHANNEL_UNTRACK = '>stop';
const USER_TRACK = '>track';
const USER_UNTRACK = '>untrack';
const TRACKIN_WHO = '>who';

// Startup
let trackingChannels = null;
const authProvider = new ClientCredentialsAuthProvider(process.env.TWITCH_ID, process.env.TWITCH_SECRET);
const apiClient = new ApiClient({ authProvider });
client.login(process.env.DISCORD_TOKEN);

// Channel and user related functions
const trackChannel = (channel) => {
    trackingChannels[channel] = [];
};

const trackUser = async (channel, user) => {
    return apiClient.helix.search.searchChannels(user)
        .then(res => {
            if (res.data.length > 0 && res.data[0].name !== user) {
                apiClient.helix.clips.getClipsForBroadcaster(res.data[0].id)
                    .then(clips => {
                        trackingChannels[channel].push({
                            id: res.data[0].id,
                            name: user,
                            lastClip: getLatestClip(clips.data).creationDate.getTime()
                        });
                    })
                    .catch(err => console.log(err));
                return res.data[0].name;
            } else {
                throw new Error('No channel found with the provided name.');
            }
        });
};

const untrackUser = (channelID, username) => {
    const channel = trackingChannels[channelID];
    const updatedList = channel.filter(item => item.name !== username);
    trackingChannels[channelID] = updatedList;
};

const untrackChannel = (channelID) => {
    delete trackingChannels[channelID];
};


const sendMessageToChannel = (channelID, message) => {
    client.channels.fetch(channelID)
        .then(channel => channel.send(message))
};

const getLatestClip = (clips) => {
    return clips.sort((a, b) => a.creationDate.getTime() < b.creationDate.getTime() ? 1 : -1)[0];
};

const getNewClips = (clips, lastClipTime) => {
    return clips.filter(clip => clip.creationDate.getTime() > lastClipTime);
};

const getTwitchDateFilter = () => {
    const date = new Date();
    date.setHours(date.getHours(), date.getMinutes(), 0);
    return date;
};

const notifyIfHasNewClip = () => {
    const date = getTwitchDateFilter().toISOString();

    Object.keys(trackingChannels).forEach(channelID => {
        if (trackingChannels[channelID].length && trackingChannels[channelID].length > 0){
            trackingChannels[channelID].forEach(user => {
                apiClient.helix.clips.getClipsForBroadcaster(user.id, {startDate: date ,limit: 100})
                    .then(clips => {
                        const newClips = getNewClips(clips.data, user.lastClip);
                        console.log(newClips.length);
                        if (user.lastClip == null || newClips.length !== 0) {
                            user.lastClip = getLatestClip(newClips).creationDate.getTime();
                            newClips.forEach(clip =>  sendMessageToChannel(channelID, clip.url));
                        }
                    })
                    .catch(err => console.log(err));
            });
        }
    });
};

// cache related functions
const persistCache = () => {
    return fs.writeFile(FILE, JSON.stringify(trackingChannels));
};

const loadCache = () => {
    return fs.readFile(FILE)
        .then(cache => {
            trackingChannels = JSON.parse(cache);
        });
}

loadCache()
    .then(() => {
        console.log('Cache loaded.');
    })
    .catch(() => {
        console.log('Could not read the cache file.');
    })
    .finally(() => {
        setupBot();
    });

const setupBot = () => {
    client.on('ready', () => {
        console.log(`Logged in as ${client.user.tag}!`);    
    });
    
    // Listeners
    client.on('message', msg => {
        if (msg.author !== client.user) {
            if (msg.content === CHANNEL_TRACK) {
                trackChannel(msg.channel.id);
                msg.channel.send('Sending stream clips to this channel!');
            }
            // Commands that require the setup method
            if (trackingChannels[msg.channel.id] != null) {
                if(msg.content.includes(USER_TRACK)) {
                    trackUser(msg.channel.id, msg.content.slice(USER_TRACK.length + 1))
                        .then(() => {
                            msg.channel.send(`Tracking user ${msg.content.slice(USER_TRACK.length + 1)} Twitch clips!`);
                        })
                        .catch(err => {
                            msg.channel.send(err.message);
                        });
                } else if (msg.content === CHANNEL_UNTRACK) {
                    untrackChannel(msg.channel.id);
                    msg.channel.send('No more clips will be sent to this channel.');
                } else if (msg.content.includes(USER_UNTRACK)) {
                    const user = msg.content.slice(USER_UNTRACK.length + 1);
                    untrackUser(msg.channel.id, user);
                    msg.channel.send(`${user} Twitch clips are not being tracked anymore.`);
                } else if (msg.content === TRACKIN_WHO) {
                    if (trackingChannels[msg.channel.id].length === 0) {
                        msg.channel.send(`No one is currently being tracked.`);
                    } else {
                        msg.channel.send(`Tracking ${trackingChannels[msg.channel.id].map(item => item.name).join(', ')}.`);
                    }
                }
            }
        }
    });

    setInterval(() => {
        if(trackingChannels != null) {
            notifyIfHasNewClip();
        }
    }, TIMER);
};

process.on('SIGINT', persistCache);
