import { useState, type InputHTMLAttributes } from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number
  /** 숫자로 읽히는 값을 칠 때마다 부른다. 비우거나 '-'만 친 중간 상태는 넘기지 않는다. */
  onValue: (v: number) => void
}

/**
 * 숫자 입력 칸. 값을 그대로 묶어 두면 칸을 비우는 순간(백스페이스) 숫자가 아니라 이전 값으로 되돌아가서 지울 수가 없다.
 * 치는 동안은 친 글자를 따로 들고 있다가, 칸을 떠나면 실제 값으로 되돌린다.
 */
export default function NumberInput({ value, onValue, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      {...rest}
      type="number"
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = e.target.valueAsNumber
        if (!Number.isNaN(v)) onValue(v)
      }}
      onBlur={(e) => {
        setDraft(null)
        onBlur?.(e)
      }}
    />
  )
}
