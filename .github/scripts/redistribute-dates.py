"""Redistribute approved main-branch dates; preserve all other commit content."""
import csv
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess

START_ISO = '2026-09-04T09:00:00-07:00'
END_ISO = '2026-09-22T03:15:00-07:00'
IDENT = re.compile(rb'^(author|committer) (.*) (-?\d+) ([+-]\d{4})$')
BACKUP = 'refs/heads/backup/main-before-date-rewrite-20260922'
MAIN = 'refs/heads/main'
EXPECTED = {
    'Sahil-Arifi/kinetic-lab': 'd366507106754f99789fcae923e61199321ac0df',
    'Sahil-Arifi/daily-games': '46ca141b724de8a7a0ad12721a5dd8bd9e93c1ee',
}


def git(*args, data=None):
    result = subprocess.run(['git', *args], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError(f'Git command failed ({args[0]}): ' +
                           result.stderr.decode('utf-8', 'replace'))
    return result.stdout


def remote_refs():
    return {line.split()[1]: line.split()[0] for line in
            git('ls-remote', '--refs', 'origin').decode('ascii').splitlines()}


def commit_parts(raw):
    headers, separator, message = raw.partition(b'\n\n')
    if not separator:
        raise ValueError('Malformed commit')
    lines = headers.split(b'\n')
    if any(line.startswith((b'gpgsig ', b'gpgsig-sha256 ', b'mergetag ')) for line in lines):
        raise ValueError('Signed commit or merge tag found; aborting before any main update')
    identities = [IDENT.match(line) for line in lines if line.startswith((b'author ', b'committer '))]
    if len(identities) != 2 or not all(identities):
        raise ValueError('Missing or malformed commit identity')
    return lines, message


def invariant_bytes(lines, message):
    result = []
    for line in lines:
        if line.startswith(b'parent '):
            continue
        match = IDENT.match(line)
        if match:
            line = match.group(1) + b' ' + match.group(2)
        result.append(line)
    return b'\n'.join(result) + b'\n\n' + message


def main(repository, expected, output):
    output.mkdir(parents=True, exist_ok=True)
    before = remote_refs()
    if before.get(MAIN) != expected or before.get(BACKUP) != expected:
        raise RuntimeError('Main or backup no longer matches approved original SHA')
    old_shas = git('rev-list', '--reverse', '--topo-order', expected).decode('ascii').splitlines()
    if not 2 <= len(old_shas) <= 500:
        raise RuntimeError(f'Unexpected history size: {len(old_shas)}')
    start = int(dt.datetime.fromisoformat(START_ISO).timestamp())
    end = int(dt.datetime.fromisoformat(END_ISO).timestamp())
    if end > int(dt.datetime.now(dt.timezone.utc).timestamp()):
        raise RuntimeError('Requested endpoint is in the future')
    # Validate the entire input before creating replacement objects.
    originals = {sha: commit_parts(git('cat-file', 'commit', sha)) for sha in old_shas}
    mapping, rows = {}, []
    for index, old_sha in enumerate(old_shas):
        old_lines, old_message = originals[old_sha]
        timestamp = start + ((end - start) * index // (len(old_shas) - 1))
        date_bytes = str(timestamp).encode('ascii') + b' -0700'
        new_lines, old_parents, new_parents, identities = [], [], [], {}
        for line in old_lines:
            if line.startswith(b'parent '):
                parent = line[7:].decode('ascii')
                if parent not in mapping:
                    raise RuntimeError('Traversal is not parent-first')
                old_parents.append(parent)
                new_parents.append(mapping[parent])
                line = b'parent ' + mapping[parent].encode('ascii')
            else:
                match = IDENT.match(line)
                if match:
                    role = match.group(1).decode('ascii')
                    identities[role] = {
                        'identity': match.group(2).decode('utf-8', 'replace'),
                        'old_timestamp': int(match.group(3)),
                        'old_offset': match.group(4).decode('ascii'),
                    }
                    line = match.group(1) + b' ' + match.group(2) + b' ' + date_bytes
            new_lines.append(line)
        new_raw = b'\n'.join(new_lines) + b'\n\n' + old_message
        new_sha = git('hash-object', '-t', 'commit', '-w', '--stdin', data=new_raw).decode('ascii').strip()
        actual_lines, actual_message = commit_parts(git('cat-file', 'commit', new_sha))
        assert invariant_bytes(old_lines, old_message) == invariant_bytes(actual_lines, actual_message)
        assert [line[7:].decode('ascii') for line in actual_lines if line.startswith(b'parent ')] == new_parents
        assert [line for line in actual_lines if line.startswith(b'tree ')] == [line for line in old_lines if line.startswith(b'tree ')]
        assert len([line for line in actual_lines if IDENT.match(line) and line.endswith(date_bytes)]) == 2
        mapping[old_sha] = new_sha
        rows.append({
            'old_sha': old_sha, 'new_sha': new_sha,
            'new_date': dt.datetime.fromtimestamp(timestamp, dt.timezone(dt.timedelta(hours=-7))).isoformat(),
            'tree': next(line[5:].decode('ascii') for line in old_lines if line.startswith(b'tree ')),
            'old_parents': old_parents, 'new_parents': new_parents,
            'identities': identities,
            'subject': old_message.split(b'\n', 1)[0].decode('utf-8', 'replace'),
        })
    new_head = mapping[expected]
    assert int(git('rev-list', '--count', new_head)) == len(old_shas)
    git('diff', '--exit-code', expected, new_head, '--')
    original_tree = git('rev-parse', expected + '^{tree}').decode('ascii').strip()
    assert git('rev-parse', new_head + '^{tree}').decode('ascii').strip() == original_tree
    report = {
        'repository': repository, 'status': 'prepared',
        'original_head': expected, 'new_head': new_head, 'tree': original_tree,
        'backup_ref': BACKUP, 'commit_count': len(rows),
        'start': START_ISO, 'end': END_ISO,
        'verified': ['every tree unchanged', 'every message byte-preserved',
                     'author and committer identities unchanged', 'parent topology preserved',
                     'commit count unchanged', 'final file contents unchanged'],
        'commits': rows,
    }
    report_path = output / 'date-rewrite-report.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    with (output / 'commit-date-map.csv').open('w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=['old_sha', 'new_sha', 'new_date', 'subject'])
        writer.writeheader()
        writer.writerows({key: row[key] for key in writer.fieldnames} for row in rows)
    immediately_before = remote_refs()
    if immediately_before.get(MAIN) != expected or immediately_before.get(BACKUP) != expected:
        raise RuntimeError('Remote advanced; refusing the rewrite')
    git('push', '--atomic', f'--force-with-lease={MAIN}:{expected}',
        'origin', f'{new_head}:{MAIN}')
    after = remote_refs()
    assert after.get(MAIN) == new_head
    assert after.get(BACKUP) == expected
    assert {ref: sha for ref, sha in immediately_before.items() if ref != MAIN} == {
        ref: sha for ref, sha in after.items() if ref != MAIN}
    report['status'] = 'complete'
    report['remote_verified'] = True
    report['other_refs_unchanged'] = True
    report['completed_at_utc'] = dt.datetime.now(dt.timezone.utc).isoformat()
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    summary = {key: value for key, value in report.items() if key != 'commits'}
    print(json.dumps(summary, indent=2))
    if 'GITHUB_STEP_SUMMARY' in os.environ:
        Path(os.environ['GITHUB_STEP_SUMMARY']).write_text(
            f'# Verified commit date redistribution\n\nRepository: `{repository}`\n\n'
            f'Commits: {len(rows)}\n\nOriginal: `{expected}`\n\nNew: `{new_head}`\n\n'
            f'Backup: `{BACKUP}`\n\nDate interval: {START_ISO} to {END_ISO}\n\n'
            'Only date fields and the required parent SHA links changed. Every tree, message, '
            'author and committer identity is preserved. Other refs are unchanged.\n', encoding='utf-8')


if __name__ == '__main__':
    os.environ['GIT_NO_REPLACE_OBJECTS'] = '1'
    repo = os.environ['GITHUB_REPOSITORY']
    main(repo, EXPECTED[repo], Path(os.environ['RUNNER_TEMP']) / 'date-rewrite-audit')
