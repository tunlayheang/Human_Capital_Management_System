import React, { useRef } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  disabled?: boolean;
};

export const OtpCodeInput: React.FC<Props> = ({ value, onChange, length = 6, disabled }) => {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const commit = (next: string) => {
    onChange(next.replace(/\D/g, '').slice(0, length));
  };

  const focusAt = (index: number) => {
    refs.current[index]?.focus();
  };

  return (
    <div className="auth-otp-grid" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={d}
          className="auth-otp-cell"
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1);
            const arr = Array.from({ length }, (_, j) => value[j] ?? '');
            arr[i] = ch;
            commit(arr.join(''));
            if (ch && i < length - 1) focusAt(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) {
              e.preventDefault();
              const arr = value.split('');
              arr.pop();
              commit(arr.join(''));
              focusAt(i - 1);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            commit(pasted);
            focusAt(Math.min(pasted.length, length - 1));
          }}
        />
      ))}
    </div>
  );
};
