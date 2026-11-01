// Run with: node --test tests/reload-bridge.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const native = path.join(__dirname, '..', 'native');
const plugins = ['mpvVideoPlayer', 'mpvAudioPlayer', 'jmpInputPlugin', 'jmpUpdatePlugin'];
const modules = plugins.map(name =>
    '(function () {\n' + fs.readFileSync(path.join(native, name + '.js'), 'utf8') + '\n})();'
).join('\n');
const info = { settings: {}, sections: [], settingsDescriptions: {}, mode: 'desktop' };
const shell = fs.readFileSync(path.join(native, 'nativeshell.js'), 'utf8')
    .replace('@@data@@', Buffer.from(JSON.stringify(info)).toString('base64'));
const source = modules + '\n' + shell;

for (const readyState of ['loading', 'complete']) {
    test('native bridge survives reload with scripts blocked, DOM ' + readyState, async () => {
        for (let reload = 0; reload < 3; reload++) {
            let domReady;
            let channelCount = 0;
            const transport = {};
            const api = { settings: {
                sectionValueUpdate: { connect() {} }, groupUpdate: { connect() {} }
            } };
            const context = {
                console,
                atob: text => Buffer.from(text, 'base64').toString('utf8'),
                sessionStorage: { getItem: () => null },
                qt: { webChannelTransport: transport },
                QWebChannel: function (actualTransport, callback) {
                    assert.equal(actualTransport, transport);
                    channelCount++;
                    callback({ objects: api });
                },
                document: {
                    readyState,
                    addEventListener(event, callback) {
                        assert.equal(event, 'DOMContentLoaded');
                        domReady = callback;
                    },
                    createElement() { throw Error('CSP: dynamic script loading blocked'); }
                }
            };
            context.window = context;
            vm.createContext(context);
            vm.runInContext(source, context);
            assert.deepEqual(Array.from(context.NativeShell.getPlugins()), plugins);
            for (const name of plugins) {
                const ctor = await context[name]();
                assert.equal(typeof ctor, 'function');
                assert.equal(ctor, context['_' + name]);
            }
            if (readyState === 'loading') {
                assert.equal(channelCount, 0);
                domReady();
            }
            await context.initCompleted;
            assert.equal(context.api, api);
            assert.equal(channelCount, 1);
        }
    });
}
