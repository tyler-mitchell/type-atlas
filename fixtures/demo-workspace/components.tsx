export interface ButtonProps {
  tone?: "primary" | "danger";
  children?: unknown;
}

export function Button(props: ButtonProps) {
  return <button>{props.children}</button>;
}

export interface ComboboxOption {
  label: string;
  value: string;
}

export interface SingleSelectComboboxProps {
  ariaLabel: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly ComboboxOption[];
}

export function SingleSelectCombobox(props: SingleSelectComboboxProps) {
  return (
    <button
      aria-label={props.ariaLabel}
      onClick={() => props.onValueChange(props.options[0]?.value ?? props.value)}
    >
      {props.placeholder ?? props.value}
    </button>
  );
}
