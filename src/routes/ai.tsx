import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Brain,
  Camera,
  Folder,
  Image,
  Menu,
  MessageSquare,
  Mic,
  MonitorUp,
  Pin,
  Plus,
  Radio,
  Search,
  Send,
  Sparkles,
  Upload,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createSautiAiCallSessionRecord,
  createSautiAiFileRecord,
  createSautiAiObservationRecord,
  createSautiAiResearchLogRecord,
  endSautiAiCallSessionRecord,
  listSautiAiWorkspaceRecord,
  recordSautiAiConversationRecord,
  upsertSautiAiMemoryRecord,
} from "@/lib/app-data.functions";
import { plainAiText } from "@/lib/ai-text";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/ai")({
  head: () => ({ meta: [{ title: "Sauti AI - Intelligence Workspace" }] }),
  component: AiPage,
});

type Msg = { id?: string; role: "user" | "assistant"; content: string; attachments?: unknown[] };
type ChatMode = "chat" | "call" | "research" | "file" | "agent";
type CallMode = "audio" | "video" | "screen";
type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  messages: Msg[];
  pinned?: boolean;
  folder?: string;
  agentKey?: string;
  mode?: ChatMode;
};
type ImageAttachment = { name: string; dataUrl: string };
type FileNote = { name: string; type: string; size: number; text?: string };
type AiMemory = {
  id: string;
  text: string;
  createdAt: string;
  memoryType?: string;
  scope?: string;
  tags?: string[];
  approved?: boolean;
};
type AiAgent = {
  key: string;
  name: string;
  description?: string;
  domain?: string;
  system_prompt?: string;
  tools?: string[];
};

const INITIAL_MESSAGE: Msg = {
  role: "assistant",
  content:
    "Hello, I'm Sauti AI. I can reason across Sauti operations, remember approved context, inspect images or screen captures, and help staff work through finance, support, operations, files, and research safely.",
};

const DEFAULT_AGENTS: AiAgent[] = [
  {
    key: "operations",
    name: "Operations AI",
    description: "Approvals, suppliers, fuel, stock, services, and field workflows.",
  },
  {
    key: "finance",
    name: "Finance Assistant",
    description: "Loans, savings, shares, dockets, penalties, and reconciliations.",
  },
  {
    key: "customer_support",
    name: "Customer Support Assistant",
    description: "Member support, policies, memos, and plain-language replies.",
  },
  {
    key: "analytics",
    name: "Analytics AI",
    description: "Trends, anomalies, reports, and management insight.",
  },
  {
    key: "developer",
    name: "Developer Assistant",
    description: "Product architecture, bugs, guardrails, and implementation planning.",
  },
];

function AiPage() {
  const store = useStore();
  const loadWorkspace = useServerFn(listSautiAiWorkspaceRecord);
  const saveConversation = useServerFn(recordSautiAiConversationRecord);
  const saveMemory = useServerFn(upsertSautiAiMemoryRecord);
  const saveObservation = useServerFn(createSautiAiObservationRecord);
  const saveAiFile = useServerFn(createSautiAiFileRecord);
  const startCallSession = useServerFn(createSautiAiCallSessionRecord);
  const stopCallSession = useServerFn(endSautiAiCallSessionRecord);
  const saveResearchLog = useServerFn(createSautiAiResearchLogRecord);

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadAiSessions());
  const [sessionId, setSessionId] = useState(() => sessions[0]?.id ?? newSessionId());
  const [msgs, setMsgs] = useState<Msg[]>(() => sessions[0]?.messages ?? [INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [fileNotes, setFileNotes] = useState<FileNote[]>([]);
  const [memories, setMemories] = useState<AiMemory[]>(() => loadAiMemories());
  const [agents, setAgents] = useState<AiAgent[]>(DEFAULT_AGENTS);
  const [agentKey, setAgentKey] = useState("operations");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [memoryScope, setMemoryScope] = useState<"private" | "team" | "organization">("private");
  const [memoryType, setMemoryType] = useState<
    "user" | "operational" | "contextual" | "governance"
  >("operational");
  const [callId, setCallId] = useState<string | null>(null);
  const [callMode, setCallMode] = useState<CallMode>("audio");
  const [observationTitle, setObservationTitle] = useState("");
  const [researchSummary, setResearchSummary] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const selectedAgent = agents.find((agent) => agent.key === agentKey) ?? agents[0];
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...sessions]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      .filter((session) => {
        if (folder && (session.folder ?? "") !== folder) return false;
        if (!q) return true;
        return (
          session.title.toLowerCase().includes(q) ||
          session.messages.some((message) => message.content.toLowerCase().includes(q))
        );
      });
  }, [folder, search, sessions]);
  const folders = useMemo(
    () =>
      Array.from(new Set(sessions.map((session) => session.folder).filter(Boolean))) as string[],
    [sessions],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    void loadWorkspace()
      .then((workspace: any) => {
        const dbAgents = Array.isArray(workspace?.agents) ? workspace.agents : [];
        if (dbAgents.length > 0) {
          setAgents(
            dbAgents.map((agent: any) => ({
              key: String(agent.key),
              name: String(agent.name),
              description: String(agent.description ?? ""),
              domain: String(agent.domain ?? ""),
              system_prompt: String(agent.system_prompt ?? ""),
              tools: Array.isArray(agent.tools) ? agent.tools : [],
            })),
          );
        }
        const dbMemories = Array.isArray(workspace?.memories)
          ? workspace.memories.map((memory: any) => ({
              id: String(memory.id),
              text: String(memory.content ?? ""),
              createdAt: String(memory.created_at ?? memory.updated_at ?? new Date().toISOString()),
              memoryType: String(memory.memory_type ?? "operational"),
              scope: String(memory.scope ?? "private"),
              tags: Array.isArray(memory.tags) ? memory.tags : [],
              approved: Boolean(memory.approved),
            }))
          : [];
        if (dbMemories.length > 0) setMemories(saveAiMemories(mergeMemories(dbMemories, memories)));
        const dbMessages = Array.isArray(workspace?.messages) ? workspace.messages : [];
        const messagesByConversation = new Map<string, Msg[]>();
        for (const message of dbMessages) {
          const conversationId = String(message.conversation_id ?? "");
          if (!conversationId) continue;
          const role = String(message.role ?? "user") === "assistant" ? "assistant" : "user";
          const list = messagesByConversation.get(conversationId) ?? [];
          list.push({
            id: String(message.id ?? ""),
            role,
            content: String(message.content ?? ""),
            attachments: Array.isArray(message.attachments) ? message.attachments : [],
          });
          messagesByConversation.set(conversationId, list);
        }
        const dbSessions = Array.isArray(workspace?.conversations)
          ? workspace.conversations.map((conversation: any) => ({
              id: String(conversation.id),
              title: String(conversation.title ?? "Sauti AI conversation"),
              updatedAt: String(conversation.updated_at ?? conversation.created_at),
              messages: messagesByConversation.get(String(conversation.id)) ?? [],
              pinned: Boolean(conversation.pinned),
              folder: conversation.folder ? String(conversation.folder) : undefined,
              agentKey: conversation.agent_key ? String(conversation.agent_key) : undefined,
              mode: String(conversation.mode ?? "chat") as ChatMode,
            }))
          : [];
        if (dbSessions.length > 0)
          setSessions((current) => saveAiSessions(mergeSessions(dbSessions, current)));
        setWorkspaceLoaded(true);
      })
      .catch((error) => {
        setWorkspaceLoaded(true);
        toast.error(error instanceof Error ? error.message : "Sauti AI workspace could not load.");
      });
  }, []);

  useEffect(() => {
    const title =
      msgs.find((message) => message.role === "user")?.content.slice(0, 58) || "New Sauti AI chat";
    const nextSession = {
      id: sessionId,
      title,
      updatedAt: new Date().toISOString(),
      messages: msgs,
      pinned: sessions.find((session) => session.id === sessionId)?.pinned ?? false,
      folder: sessions.find((session) => session.id === sessionId)?.folder,
      agentKey,
      mode,
    };
    setSessions((current) =>
      saveAiSessions([nextSession, ...current.filter((session) => session.id !== sessionId)]),
    );
  }, [agentKey, mode, msgs, sessionId]);

  function startNewChat(nextMode: ChatMode = "chat") {
    const id = newSessionId();
    setSessionId(id);
    setMode(nextMode);
    setMsgs([INITIAL_MESSAGE]);
    setAttachments([]);
    setFileNotes([]);
    setInput("");
  }

  function openChat(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setSessionId(session.id);
    setMsgs(session.messages.length ? session.messages : [INITIAL_MESSAGE]);
    setAgentKey(session.agentKey ?? agentKey);
    setMode(session.mode ?? "chat");
    setAttachments([]);
    setFileNotes([]);
    setHistoryOpen(false);
  }

  function updateCurrentSession(patch: Partial<ChatSession>) {
    setSessions((current) =>
      saveAiSessions(
        current.map((session) => (session.id === sessionId ? { ...session, ...patch } : session)),
      ),
    );
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextImages: ImageAttachment[] = [];
    const nextFiles: FileNote[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.type.startsWith("image/")) {
        nextImages.push(await readImage(file));
      } else {
        const note: FileNote = {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
        };
        if (file.type.startsWith("text/") || file.name.endsWith(".csv")) {
          note.text = (await file.text()).slice(0, 12000);
        }
        nextFiles.push(note);
      }
    }
    if (nextImages.length) setAttachments((current) => [...current, ...nextImages].slice(0, 4));
    if (nextFiles.length) {
      setFileNotes((current) => [...current, ...nextFiles].slice(0, 10));
      setMode("file");
      setInput(
        (current) =>
          current || "Summarize these file notes and suggest how Sauti should tag or act on them.",
      );
      await Promise.all(
        nextFiles.map((file) =>
          saveAiFile({
            data: {
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              textContent: file.text,
              summary: file.text
                ? "Text content captured in-browser for Sauti AI analysis."
                : "Binary file metadata captured. Full OCR/PDF/video extraction requires the document processing worker.",
              tags: [selectedAgent?.domain ?? agentKey, mode],
              status: file.text ? "processed" : "uploaded",
              metadata: { agentKey, sessionId },
            },
          }).catch(() => null),
        ),
      );
    }
  }

  async function captureFromStream(stream: MediaStream, label: string) {
    try {
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setAttachments((current) =>
        [
          ...current,
          {
            name: `${label}-${new Date().toISOString().slice(0, 19)}.jpg`,
            dataUrl: canvas.toDataURL("image/jpeg", 0.82),
          },
        ].slice(0, 4),
      );
      setInput((current) => current || `Read this ${label} capture and guide the staff member.`);
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  async function captureCameraFrame() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    await captureFromStream(stream, "camera");
  }

  async function captureScreenFrame() {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
    };
    if (!mediaDevices.getDisplayMedia) throw new Error("Screen capture is not available here.");
    const stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
    await captureFromStream(stream, "screen");
  }

  function dictate() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice dictation is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-KE";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results ?? [])
        .map((result: any) => String(result?.[0]?.transcript ?? ""))
        .join(" ")
        .trim();
      if (text) setInput((current) => (current ? `${current} ${text}` : text));
    };
    recognition.start();
  }

  function speakLastAnswer() {
    const text = msgs
      .filter((message) => message.role === "assistant" && message.content.trim())
      .at(-1)?.content;
    if (!text || typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  async function rememberCurrentInput() {
    const text = input.trim();
    if (!text) return;
    const memory: AiMemory = {
      id: newSessionId(),
      text,
      createdAt: new Date().toISOString(),
      memoryType,
      scope: memoryScope,
      tags: [selectedAgent?.domain ?? agentKey].filter(Boolean),
    };
    setMemories(saveAiMemories([memory, ...memories]));
    setInput("");
    try {
      await saveMemory({
        data: {
          id: memory.id,
          content: text,
          memoryType,
          scope: memoryScope,
          source: "staff_saved",
          tags: memory.tags,
          metadata: { agentKey, sessionId },
        },
      });
      toast.success("Sauti AI memory saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Memory saved locally only.");
    }
  }

  async function startAiCall(nextMode: CallMode) {
    setMode("call");
    setCallMode(nextMode);
    try {
      const result = (await startCallSession({
        data: { conversationId: sessionId, mode: nextMode, metadata: { agentKey } },
      })) as any;
      setCallId(String(result?.id ?? newSessionId()));
      toast.success(`${nextMode} AI session started.`);
      if (nextMode === "video") await captureCameraFrame();
      if (nextMode === "screen") await captureScreenFrame();
      dictate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start AI call.");
    }
  }

  async function endAiCall() {
    const id = callId;
    setCallId(null);
    if (!id) return;
    try {
      await stopCallSession({
        data: {
          id,
          transcript: msgs,
          sceneNotes: attachments.map((attachment) => ({ name: attachment.name })),
          metadata: { agentKey, endedFrom: "browser" },
        },
      });
      toast.success("AI call session saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save call session.");
    }
  }

  async function recordObservation() {
    const title = observationTitle.trim() || input.trim().slice(0, 140);
    if (!title) return;
    try {
      await saveObservation({
        data: {
          title,
          detail: input.trim(),
          observationType: mode === "file" ? "file" : "workflow",
          severity: "medium",
          metadata: { agentKey, sessionId },
        },
      });
      setObservationTitle("");
      toast.success("Observation recorded for review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save observation.");
    }
  }

  async function logResearch() {
    const query = input.trim();
    if (!query) return;
    try {
      await saveResearchLog({
        data: {
          query,
          summary: researchSummary || "Research request logged for controlled browsing/review.",
          trusted: false,
          metadata: { agentKey, sessionId },
        },
      });
      setResearchSummary("");
      toast.success("Research request logged.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not log research.");
    }
  }

  async function persistConversation(finalMessages: Msg[], outgoingAttachments: ImageAttachment[]) {
    const title =
      finalMessages.find((message) => message.role === "user")?.content.slice(0, 120) ||
      "Sauti AI conversation";
    try {
      await saveConversation({
        data: {
          id: sessionId,
          title,
          folder: sessions.find((session) => session.id === sessionId)?.folder,
          pinned: sessions.find((session) => session.id === sessionId)?.pinned ?? false,
          mode,
          agentKey,
          messages: finalMessages.map((message, index) => ({
            id: message.id ?? `${sessionId}-${index}`,
            role: message.role,
            content: message.content,
            attachments:
              message.role === "user"
                ? [
                    ...outgoingAttachments.map((attachment) => ({
                      name: attachment.name,
                      type: "image",
                    })),
                    ...fileNotes.map((file) => ({
                      name: file.name,
                      type: file.type,
                      size: file.size,
                    })),
                  ]
                : [],
          })),
          metadata: { fileCount: fileNotes.length, imageCount: outgoingAttachments.length },
        },
      });
    } catch {
      // Local chat history remains available if the database migration has not been applied yet.
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0 && fileNotes.length === 0) || busy) return;
    const promptText = text || "Review the attached context and explain what you can see.";
    const fileContext =
      fileNotes.length > 0
        ? `\n\nAttached files:\n${fileNotes
            .map(
              (file) =>
                `- ${file.name} (${file.type || "unknown"}, ${file.size} bytes)${
                  file.text ? `\n${file.text.slice(0, 4000)}` : ""
                }`,
            )
            .join("\n")}`
        : "";
    const userMessage: Msg = {
      role: "user",
      content:
        attachments.length > 0
          ? `${promptText}${fileContext}\n\nAttached image(s): ${attachments.map((item) => item.name).join(", ")}`
          : `${promptText}${fileContext}`,
    };
    const next: Msg[] = [...msgs, userMessage, { role: "assistant", content: "" }];
    setMsgs(next);
    setInput("");
    const outgoingAttachments = attachments;
    setAttachments([]);
    setBusy(true);

    const snapshot = {
      currentUserRole: store.currentUser.role,
      selectedAgent,
      aiMode: mode,
      counts: {
        members: store.members.length,
        loans: store.loans.length,
        tx: store.transactions.length,
        staff: store.staff.length,
      },
      members: store.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone })).slice(0, 25),
      loans: store.loans
        .map((l) => ({
          id: l.id,
          memberId: l.memberId,
          principal: l.principal,
          status: l.status,
          loanKind: l.loanKind,
        }))
        .slice(0, 35),
      penalties: (store.penalties ?? []).slice(0, 20),
      recentTx: store.transactions.slice(-25),
      sautiMemories: memories.slice(0, 20),
      fileNotes: fileNotes.map((file) => ({ name: file.name, type: file.type, size: file.size })),
    };

    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...msgs, { role: "user", content: `${promptText}${fileContext}` }]
            .filter((message) => message.role === "user" || message.role === "assistant")
            .slice(-8)
            .map((message) => ({
              role: message.role,
              content:
                message.content.length > 1800
                  ? `${message.content.slice(0, 1800)}...`
                  : message.content,
            })),
          snapshot,
          role: store.currentUser.role,
          mode: "staff",
          agentKey,
          attachments: outgoingAttachments,
        }),
      });
      if (!r.ok || !r.body) {
        const err = await r.json().catch(() => ({ error: "Failed" }));
        setMsgs((previous) =>
          previous.map((message, index) =>
            index === previous.length - 1
              ? { ...message, content: `Notice: ${err.error}` }
              : message,
          ),
        );
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              acc += content;
              const cleaned = plainAiText(acc);
              setMsgs((previous) =>
                previous.map((message, index) =>
                  index === previous.length - 1 ? { ...message, content: cleaned } : message,
                ),
              );
            }
          } catch {
            buf = `${line}\n${buf}`;
            break;
          }
        }
      }
      const finalMessages = [
        ...next.slice(0, -1),
        { role: "assistant" as const, content: plainAiText(acc) },
      ];
      setMsgs(finalMessages);
      await persistConversation(finalMessages, outgoingAttachments);
    } catch (error: unknown) {
      setMsgs((previous) =>
        previous.map((message, index) =>
          index === previous.length - 1
            ? { ...message, content: `Notice: ${error instanceof Error ? error.message : "Error"}` }
            : message,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const activeSession = sessions.find((session) => session.id === sessionId);
  const toolButtons = [
    {
      label: "Upload files",
      icon: Upload,
      kind: "file" as const,
    },
    {
      label: "Camera",
      icon: Camera,
      onClick: () => void captureCameraFrame().catch((error) => toast.error(error.message)),
    },
    {
      label: "Screen",
      icon: MonitorUp,
      onClick: () => void captureScreenFrame().catch((error) => toast.error(error.message)),
    },
    { label: "Talk", icon: Mic, onClick: dictate },
    { label: "Read aloud", icon: Volume2, onClick: speakLastAnswer },
  ];

  return (
    <main className="relative flex min-h-[calc(100vh-4rem)] flex-1 overflow-hidden bg-[linear-gradient(90deg,color-mix(in_oklch,var(--border)_42%,transparent)_1px,transparent_1px),linear-gradient(180deg,color-mix(in_oklch,var(--border)_42%,transparent)_1px,transparent_1px)] bg-[size:44px_44px]">
      <div className="absolute inset-x-0 top-0 h-32 border-b border-primary/10 bg-primary/5" />
      {historyOpen ? (
        <button
          type="button"
          aria-label="Close chat history"
          onClick={() => setHistoryOpen(false)}
          className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[min(86vw,22rem)] border-r border-border bg-card/95 p-4 shadow-xl backdrop-blur-xl transition-transform lg:static lg:z-auto lg:flex lg:w-80 lg:translate-x-0 lg:flex-col lg:shadow-none ${
          historyOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-primary">Sauti AI</div>
            <div className="mt-1 text-lg font-semibold">Command Memory</div>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-md border border-border hover:bg-muted lg:hidden"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search previous chats"
              className="w-full rounded-lg border border-border bg-muted/70 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            className="w-full rounded-lg border border-border bg-muted/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All folders</option>
            {folders.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => openChat(session.id)}
              className={`w-full rounded-lg border px-3 py-3 text-left text-xs transition ${
                session.id === sessionId
                  ? "border-primary/50 bg-primary/10 shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
                  : "border-border bg-background/70 hover:bg-muted"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="line-clamp-1 font-medium">{session.title}</span>
                {session.pinned ? <Pin className="h-3.5 w-3.5 text-primary" /> : null}
              </div>
              <div className="mt-1 text-muted-foreground">
                {session.folder || session.agentKey || "General"} /{" "}
                {new Date(session.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Brain className="h-4 w-4 text-primary" />
            Memory Stream
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto text-xs">
            {memories.slice(0, 8).map((memory) => (
              <div key={memory.id} className="rounded-md border border-border bg-background/80 p-2">
                <div className="font-medium">
                  {memory.memoryType ?? "memory"} / {memory.scope ?? "private"}
                </div>
                <div className="mt-1 line-clamp-3 text-muted-foreground">{memory.text}</div>
              </div>
            ))}
            {memories.length === 0 ? (
              <div className="text-muted-foreground">No saved memory yet.</div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="relative z-10 flex min-w-0 flex-1 flex-col px-3 py-3 sm:px-5 lg:px-7">
        <header className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/85 px-3 py-2 shadow-sm backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border hover:bg-muted lg:hidden"
              aria-label="Open chat history"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary shadow-[inset_0_0_24px_color-mix(in_oklch,var(--primary)_18%,transparent)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold sm:text-xl">Sauti AI</h1>
                <span className="hidden rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-primary sm:inline-flex">
                  {workspaceLoaded ? "Live" : "Sync"}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {selectedAgent?.name ?? "Operations AI"} /{" "}
                {selectedAgent?.description ?? "Specialist workspace"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => startNewChat("chat")}
              className="grid h-10 w-10 place-items-center rounded-lg border border-border hover:bg-muted"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                updateCurrentSession({ pinned: !sessions.find((s) => s.id === sessionId)?.pinned })
              }
              className={`grid h-10 w-10 place-items-center rounded-lg border ${
                activeSession?.pinned
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border hover:bg-muted"
              }`}
              title="Pin chat"
            >
              <Pin className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 gap-2 overflow-x-auto rounded-xl border border-border bg-card/80 p-2 backdrop-blur-xl">
            <select
              value={agentKey}
              onChange={(event) => setAgentKey(event.target.value)}
              className="min-w-44 rounded-lg border border-border bg-muted/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {agents.map((agent) => (
                <option key={agent.key} value={agent.key}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as ChatMode)}
              className="min-w-32 rounded-lg border border-border bg-muted/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="chat">Chat</option>
              <option value="call">AI call</option>
              <option value="file">Files</option>
              <option value="research">Research</option>
              <option value="agent">Agent work</option>
            </select>
            <input
              value={activeSession?.folder ?? ""}
              onChange={(event) => updateCurrentSession({ folder: event.target.value })}
              placeholder="Folder"
              className="min-w-32 rounded-lg border border-border bg-muted/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/80 p-2 backdrop-blur-xl">
            {toolButtons.map((tool) => {
              const Icon = tool.icon;
              if (tool.kind === "file") {
                return (
                  <label
                    key={tool.label}
                    className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-border hover:bg-muted"
                    title={tool.label}
                  >
                    <Icon className="h-4 w-4" />
                    <input
                      type="file"
                      accept="image/*,.pdf,.txt,.csv,.json,video/*"
                      multiple
                      className="hidden"
                      onChange={(event) => void addFiles(event.target.files)}
                    />
                  </label>
                );
              }
              return (
                <button
                  key={tool.label}
                  type="button"
                  onClick={tool.onClick}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-border hover:bg-muted"
                  title={tool.label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setToolsOpen((current) => !current)}
              className="grid h-10 w-10 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
              title="More controls"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          </div>
        </div>

        {toolsOpen ? (
          <div className="mt-3 grid gap-2 rounded-xl border border-border bg-card/90 p-3 text-xs shadow-sm backdrop-blur-xl md:grid-cols-4">
            <select
              value={memoryType}
              onChange={(event) => setMemoryType(event.target.value as typeof memoryType)}
              className="rounded-lg border border-border bg-muted/70 px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="user">User memory</option>
              <option value="operational">Operational memory</option>
              <option value="contextual">Contextual memory</option>
              <option value="governance">Governance memory</option>
            </select>
            <select
              value={memoryScope}
              onChange={(event) => setMemoryScope(event.target.value as typeof memoryScope)}
              className="rounded-lg border border-border bg-muted/70 px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="private">Private</option>
              <option value="team">Team</option>
              <option value="organization">Organization</option>
            </select>
            <input
              value={observationTitle}
              onChange={(event) => setObservationTitle(event.target.value)}
              placeholder="Observation title"
              className="rounded-lg border border-border bg-muted/70 px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={researchSummary}
              onChange={(event) => setResearchSummary(event.target.value)}
              placeholder="Research note"
              className="rounded-lg border border-border bg-muted/70 px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        ) : null}

        <div className="mt-3 flex-1 overflow-y-auto rounded-xl border border-border bg-card/70 p-4 shadow-sm backdrop-blur-xl">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {msgs.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" ? (
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                ) : null}
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-xl border px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    message.role === "user"
                      ? "border-primary/30 bg-primary text-primary-foreground"
                      : "border-border bg-background/90"
                  }`}
                >
                  {message.content || <span className="opacity-50">...</span>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {(attachments.length > 0 || fileNotes.length > 0) && (
          <div className="mx-auto mt-3 flex w-full max-w-4xl flex-wrap gap-2 text-xs">
            {attachments.map((attachment) => (
              <span
                key={attachment.name}
                className="inline-flex items-center gap-1 rounded-lg border border-primary/25 bg-primary/10 px-2 py-1 text-primary"
              >
                <Image className="h-3.5 w-3.5" />
                {attachment.name}
              </span>
            ))}
            {fileNotes.map((file) => (
              <span
                key={file.name}
                className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/20 px-2 py-1"
              >
                <Folder className="h-3.5 w-3.5" />
                {file.name}
              </span>
            ))}
          </div>
        )}

        <div className="mx-auto mt-3 w-full max-w-4xl rounded-2xl border border-primary/20 bg-card/95 p-2 shadow-[0_12px_40px_color-mix(in_oklch,var(--primary)_12%,transparent)] backdrop-blur-xl">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Sauti AI..."
              className="min-h-12 flex-1 resize-none rounded-xl border border-transparent bg-muted/70 px-4 py-3 text-sm outline-none focus:border-primary/30 focus:bg-background"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void rememberCurrentInput()}
                className="hidden h-12 w-12 place-items-center rounded-xl border border-border hover:bg-muted sm:grid"
                title="Remember"
              >
                <Brain className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void recordObservation()}
                className="hidden h-12 w-12 place-items-center rounded-xl border border-border hover:bg-muted sm:grid"
                title="Observe"
              >
                <Sparkles className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void logResearch()}
                className="hidden h-12 w-12 place-items-center rounded-xl border border-border hover:bg-muted sm:grid"
                title="Log research"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_30%,transparent)] hover:bg-primary/90 disabled:opacity-60"
                title="Send"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 px-2 text-[11px] text-muted-foreground">
            <span>
              {busy ? "Sauti AI is thinking" : callId ? `${callMode} call active` : "Ready"}
            </span>
            <button
              type="button"
              onClick={() => (callId ? void endAiCall() : void startAiCall("audio"))}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 hover:bg-muted"
            >
              <Radio className="h-3.5 w-3.5" />
              {callId ? "End call" : "Call"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function newSessionId() {
  return `sauti-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readImage(file: File) {
  return new Promise<ImageAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      const image = document.createElement("img");
      image.onload = () => {
        const maxSide = 1024;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
        resolve({ name: file.name, dataUrl: canvas.toDataURL("image/jpeg", 0.72) });
      };
      image.onerror = () => resolve({ name: file.name, dataUrl: raw });
      image.src = raw;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function mergeSessions(primary: ChatSession[], secondary: ChatSession[]) {
  const map = new Map<string, ChatSession>();
  [...primary, ...secondary].forEach((session) => map.set(session.id, session));
  return Array.from(map.values())
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 80);
}

function mergeMemories(primary: AiMemory[], secondary: AiMemory[]) {
  const map = new Map<string, AiMemory>();
  [...primary, ...secondary].forEach((memory) => map.set(memory.id, memory));
  return Array.from(map.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 200);
}

function loadAiSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem("sauti-ai:sessions") ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 80) : [];
  } catch {
    return [];
  }
}

function saveAiSessions(sessions: ChatSession[]) {
  const next = sessions.slice(0, 80);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("sauti-ai:sessions", JSON.stringify(next));
  }
  return next;
}

function loadAiMemories(): AiMemory[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem("sauti-ai:memories") ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 200) : [];
  } catch {
    return [];
  }
}

function saveAiMemories(memories: AiMemory[]) {
  const next = memories.slice(0, 200);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("sauti-ai:memories", JSON.stringify(next));
  }
  return next;
}
