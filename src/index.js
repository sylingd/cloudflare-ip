const { tcpPingPort } = require("tcp-ping-port");
const https = require('https');
const fetch = require('node-fetch');
const IP_CIDR = require("ip-cidr");

let options = {
  port: 80,
  timeout: 3000,
  downloadTime: 10000,
  pingCount: 3,
  pingConcurrency: 20,
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

async function filterTop() {
  // 筛选出3个ping最快的
  const v4 = (await getIPCidr()).ipv4_cidrs;

  let ip = [];

  const gotNewIP = () => {
    if (v4.length === 0) return;
    const x = v4.splice(0, 1);
    const cidr = new IP_CIDR(x);
    ip = [...ip, ...cidr.toArray()];
  }

  const doPing = async (i) => {
    let count = 0;
    let total = 0;
    while (++count < options.pingCount) {
      const t = time();
      const x = await ping(i);
      total += x ? time() - t : options.timeout;
    }
    return total / count;
  }

  // 开始检查
  let pingQueue = 0;
  const handleOne = async () => {
    pingQueue++;
    if (ip.length < options.pingConcurrency) {
      gotNewIP();
    }
    if (ip.length === 0) return;
    const i = ip.shift();
    const delay = await doPing(i);
    // 检查是否更优
    pingQueue--;
    while (pingQueue < options.pingConcurrency) {
      handleOne();
    }
  }

  // const v4 = (await getIPCidr()).ipv4_cidrs;
  // console.log("got cidrs");
  // let result = [];
  // v4.forEach(x => {
  //   const cidr = new IP_CIDR(x);
  //   result = [...result, ...cidr.toArray()];
  // });
  // return result;
}

async function main() {
  console.log(await getIPs());
}
main();