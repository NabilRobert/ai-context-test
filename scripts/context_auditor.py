#!/usr/bin/env python3
"""
Context Density Auditor

This tool provides objective, third-party verification of context engineering (e.g. `rtk`).
It takes a command, runs it natively and with an `rtk` prefix, and uses OpenAI's tiktoken 
to calculate the exact token count (using o200k_base for o1-preview / gpt-4o).
It then presents a comparison table including raw tokens vs compressed tokens,
savings percentage, and a signal check to verify no critical "error" or "warning"
strings were lost during compression.

Usage:
  python scripts/context_auditor.py <command> [args...]
  
Dependencies:
  pip install tiktoken rich
"""

import sys
import subprocess

try:
    import tiktoken
except ImportError:
    print("Error: The 'tiktoken' library is required.")
    print("Please install it using: pip install tiktoken")
    sys.exit(1)

try:
    from rich.console import Console
    from rich.table import Table
    from rich import box
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

def run_command(cmd_args, prefix=None):
    cmd = []
    if prefix:
        cmd.append(prefix)
    cmd.extend(cmd_args)
    
    try:
        # Run the command and capture both stdout and stderr
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = result.stdout
        if result.stderr:
            output += "\n" + result.stderr
        return output
    except FileNotFoundError:
        print(f"Error: Command not found: {cmd[0]}")
        sys.exit(1)
    except Exception as e:
        print(f"Error executing command {' '.join(cmd)}: {e}")
        sys.exit(1)

def count_tokens(text: str) -> int:
    """
    Count tokens using tiktoken.
    Configured for o1-preview / gpt-4o which use the 'o200k_base' encoding.
    """
    if not text:
        return 0
    try:
        # Using o200k_base which is for gpt-4o and o1 models
        encoding = tiktoken.get_encoding("o200k_base")
    except ValueError:
        # Fallback to cl100k_base if o200k_base is not available in an older tiktoken version
        encoding = tiktoken.get_encoding("cl100k_base")
        
    # We allow all special tokens to avoid the DisallowedSpecialTokenError
    # if the output happens to contain strings that look like special tokens.
    tokens = encoding.encode(text, allowed_special="all")
    return len(tokens)

def analyze_signal(raw_output: str, compressed_output: str, signal_term: str) -> str:
    """
    Check if a signal term (e.g., 'error', 'warning') was lost during compression.
    Case-insensitive check.
    """
    raw_lower = raw_output.lower()
    comp_lower = compressed_output.lower()
    
    term_lower = signal_term.lower()
    
    raw_count = raw_lower.count(term_lower)
    comp_count = comp_lower.count(term_lower)
    
    if raw_count == 0:
        return "N/A (Not present in raw output)"
    elif comp_count == 0:
        return f"[red]LOST[/red] ({raw_count} found in raw, 0 in compressed)" if RICH_AVAILABLE else f"LOST ({raw_count} found in raw, 0 in compressed)"
    elif comp_count < raw_count:
        return f"[yellow]PARTIAL[/yellow] (Reduced from {raw_count} to {comp_count})" if RICH_AVAILABLE else f"PARTIAL (Reduced from {raw_count} to {comp_count})"
    else:
        return f"[green]PRESERVED[/green] (Count: {comp_count})" if RICH_AVAILABLE else f"PRESERVED (Count: {comp_count})"

def main():
    if len(sys.argv) < 2:
        print("Usage: python context_auditor.py <command> [args...]")
        print("Example: python context_auditor.py git diff")
        print("Example: python context_auditor.py npm list")
        sys.exit(1)
        
    cmd_args = sys.argv[1:]
    command_str = " ".join(cmd_args)
    
    print(f"[*] Running raw command: {command_str}")
    raw_output = run_command(cmd_args)
    
    print(f"[*] Running prefixed command: rtk {command_str}")
    rtk_output = run_command(cmd_args, prefix="rtk")
    
    print("[*] Calculating exact token counts...")
    raw_tokens = count_tokens(raw_output)
    rtk_tokens = count_tokens(rtk_output)
    
    if raw_tokens == 0:
        savings_pct = 0.0
    else:
        savings_pct = ((raw_tokens - rtk_tokens) / raw_tokens) * 100.0
        
    error_signal = analyze_signal(raw_output, rtk_output, "error")
    warning_signal = analyze_signal(raw_output, rtk_output, "warning")
    
    if RICH_AVAILABLE:
        console = Console()
        table = Table(title=f"Context Density Auditor: {command_str}", box=box.ROUNDED)
        
        table.add_column("Metric", style="cyan", no_wrap=True)
        table.add_column("Value")
        
        table.add_row("Raw Tokens", f"{raw_tokens:,}")
        table.add_row("Compressed Tokens (rtk)", f"{rtk_tokens:,}")
        table.add_row("Savings Percentage", f"{savings_pct:.2f}%")
        table.add_row("Signal Check: 'Error'", error_signal)
        table.add_row("Signal Check: 'Warning'", warning_signal)
        
        console.print("\n")
        console.print(table)
    else:
        print("\n" + "="*50)
        print(f"Context Density Auditor: {command_str}")
        print("="*50)
        print(f"{'Raw Tokens':<25} | {raw_tokens:,}")
        print(f"{'Compressed Tokens (rtk)':<25} | {rtk_tokens:,}")
        print(f"{'Savings Percentage':<25} | {savings_pct:.2f}%")
        print(f"{'Signal Check: Error':<25} | {error_signal}")
        print(f"{'Signal Check: Warning':<25} | {warning_signal}")
        print("="*50 + "\n")

if __name__ == "__main__":
    main()
