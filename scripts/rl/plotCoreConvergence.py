"""Plot recorded RL updates and held-out comparisons; never smooth or synthesize curves."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[2]
artifacts = root / 'reports/artifacts/core-operations-rl-v2'
report = json.loads((root / 'reports/core-operations-rl-champion-v2.json').read_text())
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(2, 2, figsize=(14, 8), constrained_layout=True)
fig.suptitle('Malacca sandbox | RL convergence and deployed-policy value', fontsize=18, fontweight='bold', color='#12334a')
colors = ['#007f86', '#2975b6', '#bd7835', '#7762b5', '#577b47']
for color, seed in zip(colors, [17, 37, 59, 83, 101]):
    run = json.loads((artifacts / f'seed-{seed}.json').read_text())
    points = run['curve']
    steps = [p['iteration'] for p in points]
    axes[0, 0].plot(steps, [p['validationReward'] for p in points], label=f'Seed {seed}', color=color)
    axes[0, 1].plot(steps, [p['probeActionChangePercent'] for p in points], color=color)
axes[0, 0].set(title='A  Actual validation reward per iteration', xlabel='Policy improvement iteration', ylabel='Mean simulator reward')
axes[0, 0].legend(ncol=3, frameon=False, fontsize=8)
axes[0, 1].axhline(2, color='#b94b48', linestyle='--', label='2% stability threshold')
axes[0, 1].axvspan(36, 40, alpha=.12, color='#007f86')
axes[0, 1].set_yscale('symlog', linthresh=1)
axes[0, 1].set_yticks([0, 1, 2, 5, 10, 20, 50, 100], labels=['0','1','2','5','10','20','50','100'])
axes[0, 1].set(title='B  Action changes on fixed training probes', xlabel='Policy improvement iteration', ylabel='Changed head choices (%)', ylim=(0, 110))
axes[0, 1].legend(frameon=False, fontsize=8)
u = report['upgrade']
old, new = u['previousAgreement'], u['agreement']
labels = ['Mean agreement', 'Heads below 60% agreement']
old_values = [old['meanVoteShare']*100, old['belowMinimumVotePercent']]
new_values = [new['meanVoteShare']*100, new['belowMinimumVotePercent']]
for i, (label, before, after) in enumerate(zip(labels, old_values, new_values)):
    axes[1, 0].bar(i-.17, before, width=.32, color='#a9b5c0', label='Previous deployed RL' if i == 0 else None)
    axes[1, 0].bar(i+.17, after, width=.32, color='#007f86', label='New deployed RL' if i == 0 else None)
    axes[1, 0].text(i-.17, before+2, f'{before:.2f}%', ha='center', fontsize=9)
    axes[1, 0].text(i+.17, after+2, f'{after:.2f}%', ha='center', fontsize=9)
axes[1, 0].set(title='C  Five-seed ensemble, including abstention', ylabel='Percent', xticks=[0,1], xticklabels=labels, ylim=(0,110))
axes[1, 0].legend(frameon=False, fontsize=8)
for i, scenario in enumerate(report['valueAttribution']['fullScenarios']):
    d = scenario['versusPrevious']
    axes[1, 1].bar(i-.17, d['energyCostReductionPercent'], width=.32, color='#2975b6', label='Energy cost index' if i == 0 else None)
    axes[1, 1].bar(i+.17, d['carbonReductionPercent'], width=.32, color='#007f86', label='Carbon intensity index' if i == 0 else None)
axes[1, 1].set(title='D  Improvement over previous deployed RL', ylabel='Model-index reduction (%)', xticks=range(4), xticklabels=['Normal','Demand surge','Equipment stress','Recovery'])
axes[1, 1].legend(frameon=False, fontsize=8)
for ax in axes.flat:
    ax.grid(axis='y', alpha=.18)
    ax.set_axisbelow(True)
fig.supxlabel('1,052 / 228 / 228 records grouped by source month | Offline engineering simulation, not measured field savings', fontsize=10, color='#536475')
output = root / 'docs/assets/rl-convergence-v2.png'
fig.savefig(output, dpi=160)
print(output)
