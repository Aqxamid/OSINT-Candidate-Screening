async function test() {
  console.log('Sending scan request for applicant 1 (Aquamid)...');
  const res = await fetch('http://localhost:5000/api/admin/osint/scan', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer a65c91423d7f2c4134ed2f0b36dc73c42d4248e4146f93221e6268422c1c6b9c',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      confirmed: true,
      force: true,
      topSites: 10,
      timeoutMinutes: 5,
      ids: ['1']
    })
  });
  console.log('Scan response:', await res.json());

  // Poll job status every 3 seconds
  let done = false;
  while (!done) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch('http://localhost:5000/api/admin/osint/jobs/current', {
      headers: {
        'Authorization': 'Bearer a65c91423d7f2c4134ed2f0b36dc73c42d4248e4146f93221e6268422c1c6b9c'
      }
    });
    const { job } = await statusRes.json();
    console.log(`[Status] running=${job.running}, done=${job.done}/${job.total}, rows:`, job.rows);
    if (job.logs && job.logs.length) {
      console.log(`[Latest Log] ${job.logs[job.logs.length - 1]}`);
    }
    if (!job.running) {
      done = true;
      console.log('Job finished. Full job summary:', job);
    }
  }

  // Check reports
  const appRes = await fetch('http://localhost:5000/api/admin/osint/applicants', {
    headers: {
      'Authorization': 'Bearer a65c91423d7f2c4134ed2f0b36dc73c42d4248e4146f93221e6268422c1c6b9c'
    }
  });
  const data = await appRes.json();
  const app1 = data.applicants.find(a => a.id === '1');
  console.log('Applicant 1 report in DB/API:', app1.report);
}

test().catch(console.error);
