import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, X, LoaderCircle, Terminal, Cable, FileJson, ShieldCheck, CheckCircle2 } from 'lucide-react';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-shell"><header className="modal-header"><span>{title}</span><button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}><X size={19} /></button></header>{children}</div>
  </dialog>;
}
export function Spinner() { return <LoaderCircle className="spin" size={17} />; }
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const colors = ['peach', 'lavender', 'mint', 'blue'];
  const hash = Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0);
  return <span className={`avatar ${colors[hash % colors.length]} ${small ? 'avatar-small' : ''}`} title={name} aria-label={name}>{name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>;
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return <button className="icon-button" aria-label="Copier" title={error ? 'Sélectionnez le texte pour le copier' : 'Copier'} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError(true); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>;
}
export function Confirm({ title, description, onConfirm, onClose, busy }: { title: string; description: string; onConfirm: () => void; onClose: () => void; busy: boolean }) {
  return <Modal title={title} onClose={onClose}><div className="modal-body"><p className="muted">{description}</p></div><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy && <Spinner />} Supprimer</button></footer></Modal>;
}
export function McpDialog({ onClose }: { onClose: () => void }) {
  const endpoint = `${location.origin}/mcp`;
  const config = JSON.stringify({ mcpServers: { mkAgile: { url: endpoint } } }, null, 2);
  return <Modal title="Votre projet, avec un copilote" onClose={onClose} wide>
    <div className="modal-body mcp-body"><div className="feature-icon"><Cable size={26} /></div><h2>Faites équipe avec votre IA.</h2><p className="muted">Créez, organisez et découpez vos tâches depuis votre assistant grâce au protocole MCP.</p>
      <div className="connection-status"><span className="status-dot" />Serveur MCP disponible avec cette application<span className="badge">Streamable HTTP</span></div>
      <label>Adresse du serveur</label><div className="code-line"><code>{endpoint}</code><CopyButton value={endpoint} /></div>
      <label>Configuration d’un client compatible</label><div className="code-block"><pre>{config}</pre><CopyButton value={config} /></div>
      <p className="hint">Ajoutez cette adresse dans les paramètres MCP de votre assistant local. Le format de configuration dépend du client. Pour un client qui utilise stdio, consultez le README du projet.</p>
      <div className="mcp-features"><span><CheckCircle2 size={16} /> 34 outils Kanban et décisions</span><span><FileJson size={16} /> Mêmes fichiers JSON</span><span><ShieldCheck size={16} /> Usage local</span></div>
      <div className="prompt-example"><Terminal size={19} /><p>« Découpe cette carte en deux tâches et répartis ses points, puis déplace-les dans À faire. »</p></div>
      <p className="hint">Votre assistant doit pouvoir joindre cette machine. Une IA hébergée à distance ne peut pas accéder directement à votre adresse locale.</p>
    </div><footer className="modal-footer"><button className="button primary" onClick={onClose}>C’est compris</button></footer>
  </Modal>;
}
