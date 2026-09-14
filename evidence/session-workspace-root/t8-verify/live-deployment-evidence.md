# t8 — live deployment (running dsh GUI process) evidence, and the child/member-session question

## A. The four reproductions in the LIVE process (raw tool results returned to this session)
These are the exact calls the task calls 'the four captain reproductions'. They were made by the
Lead member session (a real child session of the live team, workspace /root/dshProj/my-power-dsh).

1. mpd_verif_venv {action: info}
   -> mpd_verif_venv: verif env: workspace /root/dshProj; venv /root/dshProj/.venv-rtl; work /root/dshProj/.mpd/verif
2. mpd_memory_status {}
   -> memory status: vcs=git root=/root/dshProj/.mpd/memory/agents/agent-dshproj entries=7 journal=7
3. mpd_boulder_plans {}
   -> plans:            (EMPTY; the repo has .mpd/plans/workmate-rename-delete-contract.md)
4. mpd_hashline_read {path: '.mpd/hashline-files.json'}
   -> Error: mpd-hashline: file not found: /root/dshProj/.mpd/hashline-files.json
      (the repo file /root/dshProj/my-power-dsh/.mpd/hashline-files.json EXISTS and is 62 bytes)

Conclusion: the LIVE process still exhibits the pre-fix resolution (process cwd), i.e. it does not
execute the fixed code. The fixed dists on disk are dated 2026-09-11 11:24-11:29; the process was
already running (its 11 member sessions were created 10:58:36).

## B. Why that is stale-load and NOT a missing session header in member sessions
The fix reads exec.agent.session.header.cwd. Question: do child/member sessions carry it? Measured by
reading the DURABLE session headers of the live team's own member sessions:

```
  created session id                               depth preset    cwd
 10:03:30 session-791dabbd-e011-4b33-aeb1-ac7ebf08     0 standard  /root/dshProj/my-power-dsh
 10:38:40 session-aded9c07-4cd3-4c82-ac31-22ce8c47     0 mpd       /root/dshProj/my-power-dsh
 10:58:36 1e90b1fc-b421-4b09-89fc-d2c38202f8a1         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 3455264a-6b34-480a-a62d-eee25b6f2f00         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 76c6643e-aa5f-4d2f-a1e3-8802cdfa1b7f         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 79058bc0-505e-4008-8032-f5fb8233fc91         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 8b85d921-dd62-40c2-9495-c634ae263221         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 af519c1e-2502-4b09-9068-02a40b384a68         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 e0d4ac6a-752b-4b53-a757-0d45d6ba7270         1 mpd       /root/dshProj/my-power-dsh
 10:58:36 fc10c18f-ffb4-4bdf-8c12-0c9ad941a001         1 mpd       /root/dshProj/my-power-dsh
 10:58:37 090f1fd4-afe4-4de4-b4a8-fac536f9dc2d         1 mpd       /root/dshProj/my-power-dsh
 10:58:37 0a904e62-f25b-4f91-b6b4-5988eb971d9e         1 mpd       /root/dshProj/my-power-dsh
 10:58:37 99a7d25b-c1b2-4ca6-ab33-a5243fce456d         1 mpd       /root/dshProj/my-power-dsh
```

All 11 member sessions of team mpd-default-7332aba4 (delegationDepth=1) carry cwd=/root/dshProj/my-power-dsh,
i.e. exec.agent.session.header.cwd IS present for child/member sessions. Therefore the live anomaly is
stale module code in the long-running process — a RESTART of dsh picks the fix up. (The fixed code path
itself is verified in the fresh boot below: 19/19 checks PASS.)
