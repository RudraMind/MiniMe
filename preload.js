'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = [
  'hover:enter', 'hover:leave', 'pal:click', 'house:contextmenu', 'overlay:dismiss',
  'pal:dragstart', 'pal:drag', 'pal:dragend', 'house:drag', 'house:dragend',
];
const ON_CHANNELS = ['pal:state', 'overlay:countdown', 'overlay:open', 'config:update'];
const INVOKE_CHANNELS = ['config:get', 'config:set'];

contextBridge.exposeInMainWorld('pixelpal', {
  send(channel, payload) {
    if (!SEND_CHANNELS.includes(channel)) return;
    ipcRenderer.send(channel, payload);
  },
  on(channel, callback) {
    if (!ON_CHANNELS.includes(channel)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.includes(channel)) return Promise.reject(new Error('blocked channel'));
    return ipcRenderer.invoke(channel, payload);
  },
});
