import type { ReactNode } from 'react';
import { CircleHelp, X } from 'lucide-react';

export function PageHead({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) { return <div className="page-head"><div><h2>{title}</h2><p>{description}</p></div>{actions ? <div className="toolbar">{actions}</div> : null}</div>; }
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`card ${className}`}>{children}</div>; }
export function Field({ label, children, help, tooltip, className = '' }: { label: string; children: ReactNode; help?: string; tooltip?: string; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <div className="field-label-row">
        <label>{label}</label>
        {tooltip ? (
          <button
            type="button"
            className="field-info"
            aria-label={`Ayuda sobre ${label}`}
            data-tooltip={tooltip}
          >
            <CircleHelp size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {children}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}
export function Modal({ title, children, onClose, actions, error = null, success = null }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode; error?: string | null; success?: string | null }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={17} /></button>
        </div>
        <div className="modal-body">
          {error ? <div className="error-banner modal-feedback" role="alert">{error}</div> : null}
          {success ? <div className="success-banner modal-feedback" role="status">{success}</div> : null}
          {children}
        </div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function ErrorBanner({ message }: { message: string | null }) { return message ? <div className="error-banner" role="alert">{message}</div> : null; }
export function SuccessBanner({ message }: { message: string | null }) { return message ? <div className="success-banner" role="status">{message}</div> : null; }
export function Empty({ title, description }: { title: string; description: string }) { return <div className="empty"><strong>{title}</strong>{description}</div>; }
