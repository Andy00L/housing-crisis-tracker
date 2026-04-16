@AGENTS.md

read the upgrade.md file in the root of the repo to understand what are the goal of all the changes you will make.

-- When generating a code always take inspiration and read the following files, for all code generation follow the logique on the security and bug fix prompt:

- prompt ground work: security-audit-prompt.md

-- when creating code always follow the below instruction EVERY ONE OF THEM:

- Fait des recherche pour être sur de ton fix et ce que tu vas dire.
- pas de guess.
- pas de workaround
- pas de version simplifier
- si t bloqer ou a besoin d'info suplementaire dit le moi
- Gestion des les edges casees.
- reverification de la documentation pour pas de mistake.
- ( netoyage de dead code)
- prise en consideration du code existant pour une modification correct
- never guess toujours faire des recherches en ligne pour etre sur.

-- When writing a prompt or text always folloew the bellow writing considerations:
Writing style consideration:
VERY BAD:
Overly formal, corporate tone - The language is consistently polished and business-report formal throughout, lacking natural variation in voice
Superlative-heavy language - Phrases like "unprecedented scale," "remarkable growth," "exceptional growth," "flagship success story" appear frequently
Perfect structure - The organization is almost too clean and systematic, following a very predictable pattern
Consistent formatting - The writing style remains uniform throughout, without the natural variation you'd see from human authors
Buzzword density - Heavy use of industry jargon and buzzwords in a way that feels somewhat artificial
NEVER USE LONG DASH OR DASHES ( ex: my live - ended here) use a . instead
##banned, forbidden element to never use in your reponse, banned words VERY BAD IS USING THIS: — .(LONG DASH)###
##Never use a long dash , — ###

aLTERNATIVE:
Add some personal observations or opinions
Vary the sentence structure and tone more
Include some informal language or conversational elements
Add more critical analysis or balanced perspectives
Include some industry anecdotes or personal experiences
Make the conclusions less universally positive

## Audit mode

When given an audit prompt, NEVER fix anything. Only audit and report.
Even if you see obvious bugs, document them in the report.
Fixing during audit corrupts the audit's value (you can't audit your own fix).
