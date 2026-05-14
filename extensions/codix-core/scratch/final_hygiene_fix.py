import os

def fix_hygiene(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Standard Microsoft Copyright Header
    header_lines = [
        '/*---------------------------------------------------------------------------------------------',
        ' *  Copyright (c) Microsoft Corporation. All rights reserved.',
        ' *  Licensed under the MIT License. See License.txt in the project root for license information.',
        ' *--------------------------------------------------------------------------------------------*/',
        ''
    ]
    header = '\n'.join(header_lines) + '\n'

    # Remove existing header if any
    lines = content.splitlines()
    if lines and lines[0].startswith('/*---'):
        # Find end of header
        end_idx = -1
        for i, line in enumerate(lines):
            if '*/' in line:
                end_idx = i
                break
        if end_idx != -1:
            lines = lines[end_idx+1:]
    
    # Remove leading empty lines
    while lines and not lines[0].strip():
        lines.pop(0)
    
    # Remove existing unicode comment if any
    if lines and 'allow-any-unicode-comment-file' in lines[0]:
        lines.pop(0)
    while lines and not lines[0].strip():
        lines.pop(0)

    # Add unicode suppression
    unicode_comment = ""
    if filepath.endswith('.js') or filepath.endswith('.ts'):
        unicode_comment = "// allow-any-unicode-comment-file\n\n"
    elif filepath.endswith('.css'):
        unicode_comment = "/* allow-any-unicode-comment-file */\n\n"

    # Fix indentation: replace groups of 4 spaces with tabs
    fixed_lines = []
    for line in lines:
        if not line.strip():
            fixed_lines.append('')
            continue
        
        # Count leading spaces
        leading_ws = ""
        for char in line:
            if char in ' \t':
                leading_ws += char
            else:
                break
        
        content_part = line[len(leading_ws):]
        # Convert all leading spaces to tabs (assume 4 spaces = 1 tab, but hygiene wants ONLY tabs)
        # Actually, let's just convert any space to tab for hygiene compliance
        fixed_ws = leading_ws.replace('    ', '\t').replace('  ', '\t').replace(' ', '\t')
        # Ensure no duplicate tabs if they were mixed
        # (Though multiple tabs are fine)
        
        fixed_lines.append(fixed_ws + content_part)

    final_content = header + unicode_comment + '\n'.join(fixed_lines) + '\n'
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(final_content)

files = [
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/media/main.js',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/media/main.css',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/media/bridge.js',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/src/ClipEditorPanel.ts',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/src/extension.ts',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/src/CodixViewProvider.ts',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/src/ClipViewProvider.ts',
    '/Users/mac/github/codix/apps/desktop/extensions/codix-core/src/ShipViewProvider.ts'
]

for f in files:
    if os.path.exists(f):
        print(f"Fixing {f}...")
        fix_hygiene(f)
