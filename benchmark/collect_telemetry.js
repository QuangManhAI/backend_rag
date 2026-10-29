const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const durationSec = parseInt(process.argv[2] || '195', 10);
const outPath = path.resolve(__dirname, 'results/prod_server_telemetry.json');
const logicalCores = os.cpus().length || 16;

console.log(`Starting zero-spawn Server Telemetry Collector for ${durationSec}s...`);

// Run a single PowerShell loop for the entire duration so we only spawn 1 process total
const iterations = Math.max(2, Math.floor(durationSec / 2));
const psScript = `
$samples = @()
$t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
for ($i = 0; $i -lt ${iterations}; $i++) {
  $elapsed = [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $t0) / 1000.0, 1)
  $procs = Get-Process -Name node, cloudflared, mongod -ErrorAction SilentlyContinue
  $list = @()
  foreach ($p in $procs) {
    $list += @{
      pid = $p.Id
      name = $p.ProcessName
      cpuTotalSec = [math]::Round([double]$p.CPU, 3)
      workingSetMB = [math]::Round($p.WorkingSet64 / 1MB, 1)
      privateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    }
  }
  $samples += @{
    elapsedSec = $elapsed
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    processes = $list
  }
  if ($i -lt (${iterations} - 1)) { Start-Sleep -Seconds 2 }
}
$samples | ConvertTo-Json -Depth 5 -Compress
`;

const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
const raw = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
  timeout: (durationSec + 30) * 1000,
}).trim();

const samples = JSON.parse(raw);
const sampleList = Array.isArray(samples) ? samples : [samples];
const processed = [];

for (let i = 0; i < sampleList.length; i++) {
  const cur = sampleList[i];
  const prev = i > 0 ? sampleList[i - 1] : null;
  const dt = prev ? Math.max(0.5, cur.elapsedSec - prev.elapsedSec) : 2.0;

  const procs = Array.isArray(cur.processes) ? cur.processes : [cur.processes];
  const nodeProcs = procs.filter((p) => p && p.name === 'node').sort((a, b) => b.workingSetMB - a.workingSetMB);
  const mongoProcs = procs.filter((p) => p && (p.name === 'cloudflared' || p.name === 'mongod')).sort((a, b) => b.workingSetMB - a.workingSetMB);

  const nodeCur = nodeProcs[0] || { pid: 0, cpuTotalSec: 0, workingSetMB: 0, privateMB: 0 };
  const mongoCur = mongoProcs[0] || { pid: 0, name: 'cloudflared', cpuTotalSec: 0, workingSetMB: 0, privateMB: 0 };

  let nodeCpuPct = 0;
  let mongoCpuPct = 0;
  if (prev) {
    const prevProcs = Array.isArray(prev.processes) ? prev.processes : [prev.processes];
    const prevNode = prevProcs.find((p) => p && p.pid === nodeCur.pid);
    const prevMongo = prevProcs.find((p) => p && p.pid === mongoCur.pid);
    if (prevNode && nodeCur.cpuTotalSec >= prevNode.cpuTotalSec) {
      nodeCpuPct = Math.round(((nodeCur.cpuTotalSec - prevNode.cpuTotalSec) / dt) * 100 * 10) / 10;
    }
    if (prevMongo && mongoCur.cpuTotalSec >= prevMongo.cpuTotalSec) {
      mongoCpuPct = Math.round(((mongoCur.cpuTotalSec - prevMongo.cpuTotalSec) / dt) * 100 * 10) / 10;
    }
  }

  processed.push({
    elapsedSec: cur.elapsedSec,
    timestamp: cur.timestamp,
    node: {
      pid: nodeCur.pid,
      cpuPctSingleCoreEquiv: nodeCpuPct,
      cpuPctTotalSystem: Math.round((nodeCpuPct / logicalCores) * 10) / 10,
      workingSetMB: nodeCur.workingSetMB,
      privateMB: nodeCur.privateMB,
    },
    dbTunnel: {
      pid: mongoCur.pid,
      processName: mongoCur.name || 'cloudflared',
      cpuPctSingleCoreEquiv: mongoCpuPct,
      cpuPctTotalSystem: Math.round((mongoCpuPct / logicalCores) * 10) / 10,
      workingSetMB: mongoCur.workingSetMB,
      privateMB: mongoCur.privateMB,
    },
  });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ logicalCores, samples: processed }, null, 2));
console.log(`Saved ${processed.length} telemetry samples to ${outPath}`);
