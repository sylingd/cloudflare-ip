const { tcpPingPort } = require("tcp-ping-port");
const https = require('https');
const fetch = require('node-fetch');
const IP_CIDR = require("ip-cidr");

let options = {
  port: 80,
  timeout: 1000,
  downloadTime: 10000,
  pingCount: 3,
  pingConcurrency: 30,
}

function setOptions(option) {
  options = {
    ...options,
    ...option
  };
}

function time() {
  return new Date().getTime();
}

let cidr_cache = null;
async function getIPCidr() {
  if (cidr_cache === null) {
    const x = await fetch('https://api.cloudflare.com/client/v4/ips');
    const res = await x.json();
    cidr_cache = res.result;
  }
  return cidr_cache;
}

async function ping(host) {
  const res = await tcpPingPort(host, options.port, {
    socketTimeout: options.timeout
  });

  return res.online;
}

async function filterPingTop() {
  return new Promise(async (resolve) => {
    // 筛选出3个ping最快的
    const v4 = (await getIPCidr()).ipv4_cidrs;
    const top = [];
    const topDelay = [];
    let topMaxIndex = -1;

    let ip = [];

    const gotNewIP = () => {
      if (v4.length === 0) return;
      const x = v4.shift();
      const cidr = new IP_CIDR(x);
      ip = [...ip, ...cidr.toArray()];
    }

    const doPing = async (i) => {
      let count = 0;
      let total = 0;
      while (count++ < options.pingCount) {
        const t = time();
        const x = await ping(i);
        total += x ? time() - t : options.timeout;
      }
      return total / options.pingCount;
    }

    // 开始检查
    let pingQueue = 0;
    let pingFinish = false;
    const checkNext = async () => {
      if (ip.length < options.pingConcurrency) {
        gotNewIP();
      }
      if (ip.length === 0) {
        pingFinish = true;
        return;
      }
      pingQueue++;
      const i = ip.shift();
      const delay = await doPing(i);
      console.log("Ping:", i, delay);
      const addCurrent = () => {
        top.push(i);
        topDelay.push(delay);
        const max = Math.max(...topDelay);
        const maxIndex = topDelay.findIndex(x => x === max);
        topMaxIndex = maxIndex;
      }
      // 检查是否更优
      if (delay < options.timeout) {
        if (topMaxIndex === -1 || top.length < 5) {
          addCurrent();
        } else {
          const curMax = topDelay[topMaxIndex];
          if (curMax > delay) {
            // 当前IP延迟更低
            top.splice(topMaxIndex, 1);
            topDelay.splice(topMaxIndex, 1);
            addCurrent();
            if (delay < 200) {
              pingFinish = true;
            }
          }
        }
      }
      pingQueue--;
      while (pingQueue < options.pingConcurrency && !pingFinish) {
        checkNext();
      }
      if (pingFinish && pingQueue === 0) {
        handleFinish();
      }
    }

    const handleFinish = () => {
      // console.log("handleFinish");
      // 按照Ping排序
      const delay = topDelay.sort();
      const result = delay.map(d => topDelay.findIndex(v => v === d)).map(i => top[i]);
      // console.log("result", result);
      resolve(result);
    }

    checkNext();
  });
}

function checkSingleSpeed(ip) {
  return new Promise(resolve => {
    let isDownloaded = false;
    const startTime = time();
    let endTime = time();
    let totalSize = 0;
    const request = https.get({
      host: ip,
      port: '443',
      path: '/cache.png',
      headers: {
        'Host': 'speedtest.udpfile.com'
      }
    }, res => {
      res.on('data', chunk => {
        endTime = time();
        totalSize += chunk.length;
      });
      res.on('end', () => {
        isDownloaded = true;
        handleFinish();
      });
    });

    let timer = setTimeout(() => {
      if (!isDownloaded) {
        request.destroy();
      }
    }, options.downloadTime);

    const handleFinish = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      console.log("download", totalSize, endTime);
      resolve(totalSize / ((endTime - startTime) / 1000));
    }
  });
}

async function checkSpeed(ips) {
  const result = {};
  for (const ip of ips) {
    result[ip] = await checkSingleSpeed(ip);
  }
  return result;
}

async function main() {
  // const ips = await filterPingTop();
  // console.log("ips", ips);
  const ips = [
    '173.245.49.3',
    '173.245.49.5',
    '173.245.49.16',
    '173.245.49.18',
    '173.245.49.20'
  ];
  console.log(await checkSpeed(ips));
}
main();