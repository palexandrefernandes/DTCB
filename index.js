const Discord = require('discord.js');
const client = new Discord.Client();
const fs = require('fs').promises;
const path = require('path');
const { ApiClient } = require('twitch');
const { ClientCredentialsAuthProvider } = require('twitch-auth');

const FILE = path.resolve(`${__dirname}/mem.json`);
// const TIMER = 60 * 1000 * 5;
const TIMER = 1000 * 5;

// Credentials
const DISCORD_TOKEN = 'Nzk2MDkzMDM5Njc5MzczMzEy.X_S5aw.uYh9OGtXm1QYac0Xn5fkQRroE1g';
const TWITCH_ID = 'eu9kgivuvogjy8ks9hf9fq41fs9tzn';
const TWITCH_SECRET = '1d6iepfcb46ksuyhsktwd1nzle6gum';

// Commands
const CHANNEL_TRACK = '>setup';
const CHANNEL_UNTRACK = '>stop';
const USER_TRACK = '>track';
const USER_UNTRACK = '>untrack';
const TRACKIN_WHO = '>who';

// Startup
let trackingChannels = {};
const authProvider = new ClientCredentialsAuthProvider(TWITCH_ID, TWITCH_SECRET);
const apiClient = new ApiClient({ authProvider });
client.login(DISCORD_TOKEN);

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
                return res.data[0].name;
            } else {
                throw new Error('No channel found with the provided name.');
            }
        });
};

const untrackUser = (channelID, username) => {
    const channel = trackingChannels[channelID];
    const updatedList = channel.filter(item => item.name !== username);
    trackingChannels.set(channelID, updatedList);
};

const untrackChannel = (channelID) => {
    delete trackingChannels[channelID];
};


const sendMessageToChannel = (channelID, message) => {
    client.channels.fetch(channelID).then(channel => channel.send(message));
};

const getLatestClip = (clips) => {
    return clips.sort((a, b) => a.creationDate.getTime() < b.creationDate.getTime() ? 1 : -1)[0];
};

const notifyIfHasNewClip = () => {
    Object.keys(trackingChannels).forEach(channelID => {
        trackingChannels[channelID].forEach(user => {
            apiClient.helix.clips.getClipsForBroadcaster(user.id)
                .then(clips => {
                    const latestClip = getLatestClip(clips.data);
                    if (user.lastClip == null || latestClip.creationDate.getTime() < user.lastClip) {
                        user.lastClip = latestClip.creationDate.getTime();
                        sendMessageToChannel(channelID, latestClip.url);
                    }
                })
        });
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
            } else if(msg.content.includes(USER_TRACK)) {
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
                const user = msg.content.slice(USER_UNTRACK + 1);
                untrackUser(msg.channel.id, user);
                msg.channel.send(`${user} Twitch clips are not being tracked anymore.`);
            } else if (msg.content === TRACKIN_WHO) {
                msg.channel.send(`Tracking ${trackingChannels[msg.channel.id].map(item => item.name).join(', ')}.`);
            }
        }
    });

    setInterval(notifyIfHasNewClip, TIMER);
};

process.on('SIGINT', persistCache);