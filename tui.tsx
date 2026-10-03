import { Plugin } from '@opencode/plugin/tui';
import { createEffect, createMemo, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { projectMonitor, safeLabel } from './projection.ts';
import { createMonitorHost, type ReadBudget } from './host.ts';
import { readProjectContext, SOURCE_LIMIT } from './project-context.ts';
import { interruptSession, createOutputView, type OutputResult } from './actions.ts';
import { copy } from './copy.ts';
import { readTaskChecklist, type PlanRef } from './task-checklist.ts';
import type { MonitorSnapshot, RequestRecord, SelectionKey, ToolRecord, SessionRecord } from './types.ts';

export default Plugin.define({
  id: 'local.task-monitor',
  setup(ctx) {
    const locale = ctx.options.locale === 'en' ? 'en' : 'vi';
    const t = copy(locale);
    const projectDirectory = typeof ctx.options.projectDirectory === 'string' ? ctx.options.projectDirectory : undefined;
    const plans = Array.isArray(ctx.options.plans) ? ctx.options.plans as (PlanRef & {sessionID:string})[] : [];
    const [revision, changed] = createSignal(0);
    const [output, setOutput] = createSignal<OutputResult>();
    const [busy, setBusy] = createSignal(false);
    const [actionsOpen, setActionsOpen] = createSignal(false);
    const [projectDetail, setProjectDetail] = createSignal(false);
    let selection: SelectionKey | undefined, serial = 0;
    const lifetime = new AbortController();
    let selectionAbort = new AbortController();
    const unwrap = <T,>(result: T | { data: T }): T => result && typeof result === 'object' && 'data' in result ? result.data : result as T;
    const location = (directory: string) => ({ directory });

    async function nativeSnapshot(key: SelectionKey, signal: AbortSignal, read: ReadBudget): Promise<MonitorSnapshot> {
      const selected = await read(() => ctx.client.session.get({ sessionID: key.sessionID }, { signal }), signal);
      const root = ctx.data.session.root(key.sessionID) ?? key.sessionID;
      const activity = unwrap(await read(() => ctx.client.session.active({}, { signal }), signal));
      const members = [...(ctx.data.session.family(root) ?? [])].sort((a,b)=>Number(b in activity)-Number(a in activity));
      const ids = [...new Set([key.sessionID, root, ...members])].slice(0, 10);
      const records = await Promise.all(ids.map(id => id === key.sessionID ? Promise.resolve(selected) : read(() => ctx.client.session.get({ sessionID: id }, { signal }), signal)));
      const shells = unwrap(await read(() => ctx.client.shell.list({ location: location(key.directory) }, { signal }), signal));
      const requests: RequestRecord[] = [];
      let requestsKnown = true;
      for (const id of ids) {
        if (!ctx.data.session.permission.list(id)) await read(() => ctx.data.session.permission.sync(id), signal);
        if (!ctx.data.session.form.list(id,location(key.directory))) await read(() => ctx.data.session.form.sync(id, location(key.directory)), signal);
        const permissions = ctx.data.session.permission.list(id);
        const forms = ctx.data.session.form.list(id, location(key.directory));
        if (!permissions || !forms) requestsKnown = false;
        for (const p of permissions ?? []) requests.push({id:p.id,sessionID:p.sessionID,kind:'permission',label:safeLabel(p.action)});
        for (const q of forms ?? []) requests.push({id:q.id,sessionID:q.sessionID,kind:'question',label:safeLabel(q.title)});
      }
      const cached = ctx.data.session.message.list(key.sessionID);
      const messages = cached ?? (await read(() => ctx.client.message.list({ sessionID: key.sessionID, limit: '20', order: 'desc' }, { signal }), signal)).data;
      const tools: ToolRecord[] = [];
      for (const m of messages.slice(-20)) if (m.type === 'assistant') for (const p of m.content) if (p.type === 'tool') tools.push({ id:p.id,sessionID:key.sessionID,name:p.name,status:p.state.status,created:p.time.created });
      const queued = ctx.data.session.pending.list(key.sessionID);
      return { selection:key,sessions:{kind:'ready',value:records as SessionRecord[]},activity:{kind:'ready',value:new Set(Object.keys(activity))},tools:{kind:'ready',value:tools},requests:requestsKnown?{kind:'ready',value:requests}:{kind:'loading'},shells:{kind:'ready',value:shells},shellDirectory:key.directory,queued:queued?{kind:'ready',value:queued.length}:{kind:'loading'},complete:false };
    }
    const host = createMonitorHost({
      changed: () => changed(n => n + 1), snapshot: nativeSnapshot,
      failed: () => console.warn('[local.task-monitor] native read unavailable; refresh'),
      checklist: (key, signal, read) => {
        const ref=plans.find(p=>p.sessionID===key.sessionID);
        return ref ? readTaskChecklist(key,ref,[ref.directory],{read:async(directory,path,abort)=>read(()=>ctx.client.file.read({path,location:location(directory)},{signal:abort}),abort)},signal) : Promise.resolve(undefined);
      },
      context: (key, signal, read) => projectDirectory ? readProjectContext(key,{directory:projectDirectory},{read:async(directory,path,abort)=>{
        const bytes = await read(() => ctx.client.file.read({ path, location:location(directory) }, { signal:abort }), abort);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > SOURCE_LIMIT) throw new Error('source-size-or-format-limit');
        return bytes;
      }},signal) : Promise.resolve({kind:'unmatched',selection:key}),
    });
    const currentSelection = () => {
      const route=ctx.ui.router.current();
      return route.type==='session'&&route.sessionID===selection?.sessionID ? selection : {sessionID:'',directory:'',revision:-1};
    };
    const choose = (id: string) => {
      const directory = ctx.data.session.get(id)?.location.directory;
      if (!directory || (selection?.sessionID === id && selection.directory === directory)) return;
      selectionAbort.abort();selectionAbort=new AbortController();outputView.close();
      selection = {sessionID:id,directory,revision:++serial}; setOutput(undefined); setProjectDetail(false); host.select(selection);
    };
    const view = createMemo(() => { revision(); const value=host.current(); return value ? projectMonitor(value) : undefined; });
    const context = createMemo(() => { revision(); return host.context(); });
    const checklist = createMemo(() => { revision(); return host.checklist(); });
    const tasks = () => {const c=checklist();return c?.kind==='ready'?c.items:[];};
    const agentJob = (id:string) => { const messages=ctx.data.session.message.list(id)??[];for(const m of [...messages].reverse().slice(0,20))if(m.type==='assistant')for(const p of m.content)if(p.type==='tool'&&(p.state.status==='running'||p.state.status==='streaming'))return safeLabel(p.name);return '';};
    const openSession = (id: string) => {
      if (!view()?.familyIDs.has(id)) return;
      ctx.ui.router.navigate({type:'session',sessionID:id});
    };
    const interruptPort = {
      currentSelection,
      freshSnapshot: (key: SelectionKey, signal=selectionAbort.signal) => nativeSnapshot(key,signal,host.read),
      confirm: ({id,title}: {id:string;title:string}) => ctx.ui.dialog.confirm({title:t.confirm,message:`${safeLabel(title)}\n${id}\n\n${t.consequence}`,label:{confirm:t.stop,cancel:t.back}}),
      interrupt: async(id:string,resume:false) => { await ctx.client.session.interrupt({sessionID:id,resume}); },
    };
    const outputView=createOutputView({currentSelection,freshSnapshot:interruptPort.freshSnapshot,
      output:async(directory,shellID,cursor,limit,signal)=>unwrap(await host.read(()=>ctx.client.shell.output({id:shellID,location:location(directory),cursor:String(cursor),limit:String(limit)},{signal}),signal)),
    },setOutput);
    async function stop(id: string) {
      if (busy() || !selection) return; setBusy(true);
      try {
        const result=await interruptSession(id,selection,interruptPort);
        if(result.kind!=='cancelled')ctx.ui.toast.show({message:result.kind==='sent'?t.sent:result.kind==='stale'?t.stale:t.failed,variant:result.kind==='sent'?'info':'warning'});
        await host.refresh();
      } finally { setBusy(false); }
    }
    async function showOutput(id: string) {
      if (!selection || busy()) return; setBusy(true);
      try { await outputView.open(id,selection); }
      finally {setBusy(false);}
    }
    const open = () => { const route=ctx.ui.router.current(); if(route.type!=='session')return; choose(route.sessionID);ctx.ui.panel.open('local.task-monitor'); };
    const muted=ctx.theme.text.muted, base=ctx.theme.text.base;
    const link = (title: string, run: () => void) => <text height={1} flexShrink={0} fg={ctx.theme.text.action} onMouseDown={run}>{title}</text>;
    async function selectAction() {
      if(actionsOpen())return;
      setActionsOpen(true);
      try {
      const actions:{title:string;value:string;run:()=>void}[]=[{title:t.refresh,value:'refresh',run:()=>{void host.refresh();}}];
      for(const row of view()?.runningChildren??[])actions.push({title:safeLabel(row.title??row.id),value:`session:${row.id}`,run:()=>openSession(row.id)});
      for(const row of view()?.attention??[])actions.push({title:`${row.kind==='permission'?t.permission:t.question}: ${safeLabel(row.label)}`,value:`request:${row.id}`,run:()=>openSession(row.sessionID)});
      for(const row of view()?.shells??[])actions.push({title:`${t.output} · ${row.id.slice(-8)}`,value:`output:${row.id}`,run:()=>{void showOutput(row.id);}});
      if(view()?.canInterrupt&&selection) {const id=selection.sessionID;actions.push({title:t.stop,value:`interrupt:${id}`,run:()=>{void stop(id);}});}
      const selected=await ctx.ui.dialog.select({title:t.open,options:actions.map(({title,value})=>({title,value}))});
      actions.find(a=>a.value===selected)?.run();
      } finally { setActionsOpen(false); }
    }

    function Summary(props: {sessionID: string}) {
      createEffect(() => { choose(props.sessionID); });
      return <box flexDirection="column" paddingBottom={1} maxHeight={18}>
        {link(`› ${t.open}`,open)}
        <Show when={!view()?.attentionKnown || !!view()?.attentionCount}>
          <text fg={base}><b>{t.attention}</b> {view()?.attentionKnown?`${view()?.attentionCount} ${t.loaded}`:'…'}</text>
          <text fg={muted}>{view()?.attentionKnown?t.partial:t.unknown}</text>
        </Show>
        <Show when={!!view()?.runningChildren.length || !!view()?.runningShells.length}>
          <text fg={base}><b>{t.agents}</b></text>
          <For each={view()?.runningChildren.slice(0,2)}>{row=><box flexDirection="column">{link(`› ${safeLabel(row.title??row.id)}`,()=>openSession(row.id))}<Show when={agentJob(row.id)}><text fg={muted}>{agentJob(row.id)}</text></Show></box>}</For>
          <For each={view()?.runningShells.slice(0,2)}>{row=>link(`› ${t.output} · ${row.id.slice(-8)}`,()=>{open();void showOutput(row.id);})}</For>
        </Show>
        <Show when={tasks().length}><text fg={base}><b>{t.checklist}</b></text><For each={tasks().slice(0,5)}>{item=><text fg={item.state==='done'?muted:base}>{item.state==='done'?'✓':item.state==='active'?'›':'○'} {safeLabel(item.label)}</text>}</For></Show>
      </box>;
    }
    function Panel(props: {name:string;sessionID:string;focused:boolean;close():void;focus():void}) {
      createEffect(()=>{choose(props.sessionID);});
      onMount(props.focus);
      onCleanup(()=>{outputView.close();setOutput(undefined);});
      ctx.keymap.layer(()=>({mode:'global',bindings:actionsOpen()||busy()?[]:['local.task-monitor.panel.refresh','local.task-monitor.panel.close','local.task-monitor.panel.actions'],commands:[
        {id:'local.task-monitor.panel.refresh',bind:'r',enabled:()=>props.focused&&!actionsOpen()&&!busy(),run:()=>host.refresh()},
        {id:'local.task-monitor.panel.close',bind:'escape',enabled:()=>props.focused&&!actionsOpen()&&!busy(),run:props.close},
        {id:'local.task-monitor.panel.actions',bind:'return',enabled:()=>props.focused&&!actionsOpen()&&!busy(),run:selectAction},
      ]}));
      return <box flexDirection="column" padding={1} flexGrow={1}>
        <box flexDirection="row" height={1} flexShrink={0}>
          <text height={1} flexGrow={1} fg={base}><b>{t.open}</b> · {view()?t.states[view()!.state]:t.states.loading}</text>
          <text id="local-task-monitor-close" width={t.back.length+2} height={1} flexShrink={0} fg={ctx.theme.text.action} onMouseDown={props.close}>‹ {t.back}</text>
        </box>
        {link(`↻ ${t.refresh}`,()=>{setOutput(undefined);void host.refresh();})}
        <scrollbox flexGrow={1}>
          <Show when={view()?.canInterrupt}>{link(busy()?'…':`■ ${t.stop}`,()=>{if(selection)void stop(selection.sessionID);})}</Show>
          <Show when={output()}>
            {link(`‹ ${t.back}`,()=>{outputView.close();setOutput(undefined);})}
            <text fg={muted}>{t.snapshot}</text>
            <text fg={base}>{output()?.kind==='ready'?(output() as Extract<OutputResult,{kind:'ready'}>).output:t.failed}</text>
            <Show when={output()?.kind==='ready'&&(output() as Extract<OutputResult,{kind:'ready'}>).truncated}><text fg={muted}>{t.truncated}</text></Show>
          </Show>
          <Show when={!output()}>
            <text fg={base}><b>{t.checklist}</b></text>
            <Show when={tasks().length} fallback={<text fg={muted}>{t.noPlan}</text>}><For each={tasks()}>{item=><text fg={item.state==='done'?muted:base}>{item.state==='done'?'✓':item.state==='active'?'›':'○'} {safeLabel(item.label)}</text>}</For></Show>
            <Show when={!view()?.attentionKnown||!!view()?.attentionCount}>
            <text fg={base}><b>{t.attention}</b> {view()?.attentionKnown?view()?.attentionCount:'…'}</text>
            <text fg={muted}>{t.partial}</text>
            <For each={view()?.attention}>{row=>link(`› ${row.kind==='permission'?t.permission:t.question}: ${safeLabel(row.label)}`,()=>openSession(row.sessionID))}</For>
            </Show>
            <text fg={base}><b>{t.agents}</b></text>
            <For each={view()?.runningChildren}>{row=><box flexDirection="column">{link(`› ${safeLabel(row.title??row.id)}`,()=>openSession(row.id))}<Show when={agentJob(row.id)}><text fg={muted}>{agentJob(row.id)}</text></Show></box>}</For>
            <For each={view()?.shells}>{row=>link(`› ${t.output} · ${row.status} · ${row.id.slice(-8)}`,()=>void showOutput(row.id))}</For>
            <Show when={context()?.kind==='ready'}>
              {link(`› ${t.project}`,()=>setProjectDetail(!projectDetail()))}
              <Show when={projectDetail()}>
              <text fg={base}><b>{t.project}</b></text>
              <text fg={base}>{context()?.kind==='ready'?(context() as Extract<ReturnType<typeof host.context>,{kind:'ready'}>).value.nextAction:''}</text>
              <Show when={projectDetail()}><text fg={muted}>{context()?.kind==='ready'?(context() as Extract<ReturnType<typeof host.context>,{kind:'ready'}>).value.checkpoint:''}</text></Show>
              <text fg={muted}>{t.source}: Roadmap / active Plan · {t.readAt} {context()?.kind==='ready'?new Date((context() as Extract<ReturnType<typeof host.context>,{kind:'ready'}>).readAt).toLocaleTimeString():''}</text>
              </Show>
            </Show>
            <Show when={context()&&context()?.kind!=='ready'&&context()?.kind!=='unmatched'}><text fg={muted}>{t.project}: {t.states.unavailable}</text></Show>
          </Show>
        </scrollbox>
      </box>;
    }
    const cleanups = [
      ctx.ui.slot({prepend:'sidebar.content',render:props=><Summary sessionID={props.sessionID}/>}),
      ctx.ui.slot({append:'session.panel',render:props=><Show when={props.name==='local.task-monitor'}><Panel {...props}/></Show>}),
      ctx.ui.slot({append:'app',render:()=>{
        createEffect(()=>{
          const route=ctx.ui.router.current();
          if(route.type==='session')choose(route.sessionID);
          else {selectionAbort.abort();outputView.close();selection=undefined;setOutput(undefined);host.clear();}
        });
        ctx.keymap.layer(()=>({mode:'global',commands:[{id:'local.task-monitor.open',title:t.open,group:'Task Monitor',palette:true,slash:{name:'monitor'},run:open},{id:'local.task-monitor.refresh',title:t.refresh,group:'Task Monitor',palette:true,run:()=>host.refresh()}]}));return null;
      }}),
      ctx.data.on('session.execution.succeeded',event=>{if(event.data.sessionID===selection?.sessionID)void host.turn(String(event.data.id??event.data.sessionID)+':'+String(ctx.data.session.get(event.data.sessionID)?.time.updated));}),
      ctx.data.on('session.execution.failed',event=>{if(event.data.sessionID===selection?.sessionID)void host.turn(String(event.data.id??event.data.sessionID)+':'+String(ctx.data.session.get(event.data.sessionID)?.time.updated));}),
    ];
    let refreshTimer:ReturnType<typeof setTimeout>|undefined;
    cleanups.push(ctx.data.listen(({details})=>{
      const type=details.type;
      if(!/^(session|shell|permission|form)\./.test(type)||/^session\.(text|reasoning)\./.test(type)||type==='session.updated'||type==='session.execution.succeeded'||type==='session.execution.failed')return;
      const id=details.data?.sessionID??details.data?.metadata?.sessionID??details.data?.parentID??details.data?.id;
      if(!id||!view()?.familyIDs.has(id)||refreshTimer)return;
      refreshTimer=setTimeout(()=>{refreshTimer=undefined;void host.refresh(false,true);},150);
    }));
    return ()=>{if(refreshTimer)clearTimeout(refreshTimer);lifetime.abort();selectionAbort.abort();outputView.close();host.dispose();for(const stop of cleanups)stop();if(ctx.ui.panel.current()?.name==='local.task-monitor')ctx.ui.panel.close();};
  },
});
