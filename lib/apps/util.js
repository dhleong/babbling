
const awaitMessageOfType = (session, type) => new Promise((resolve, reject) => {
    let onMessage;
    const timeoutId = setTimeout(() => {
        session.removeListener('message', onMessage);
        reject(new Error("Timeout waiting for " + type));
    }, 5000);
    onMessage = message => {
        if (message.type === type) {
            clearTimeout(timeoutId);
            session.removeListener('message', onMessage);
            resolve(message);
        }
    };
    session.on('message', onMessage);
});

module.exports = {
    awaitMessageOfType,
};
