Nam is currently working on:
Read the repo, code. The issue: right now projects are based on user + repo, packages are based on user+repo+branch+commit+role+scope, other features like architecture, dependency, capabilities, workflows, tutorials are all connected to the package, so when you generate new package, those features get overwritten as top to be retrieved and you can swtich them, even through previous package is available. I want to rework UI/UX of project dashboard to be based on different branch/scope/commit, as right now it uses old design that assumed one commit=one project. And you could only have one package, whereas you now could have several. New design should know that there may be several generations running at the same time. Meaning you will also have to rework analysis status. You will also have to remove role chooser in tutorial tab. What I mostly don't like about project overview is that you can only have one unchangable branch/scope/commit unless you overwrite it by generating new package. You should be able to change it and choose default package. Can you also fix analysis status snapshots, I want to open the previous runs, scroll and see it. Actions taken, generated section or whole package. See the whole cost. Also, when you drill down in dependency graph, you don'y have a button to come back, drill up.

Scalability (configuration of limit), efficiency; large repo graph scaling
Webhook: on push commit in github, re-analyse (not on by default, turn on in settings) - make sure to consider Git concurrency (updated when analysing and other cases)
UI hover that highlight line in code snippets
AI disabled - more thorough generation of package, maybe give the same evidence that would’ve been given to Full AI version and more polished package for understanding.
Reviewed button in onboarding is not intuitive that it should be clicked for review, maybe add to the tour or make the button puffy.
Tie dark/light theme of app to browser’s current theme
In the dependency graph, it is not intuitive that you clicked on a node and how to get out. So animation of zooming in/out of nodes.
Keyboard hotkeys, to change tabs, move nodes/steps in tutorial, think of where is useful
Introduce option in account settings to disconnect GitHub, delete account, change name, avatar. Also, add the option in “sign in/out” for “forgot the password” to reset password. Also in “sign in/on” add the option to go back to the intro page. Change transfer page functions, if you are signed in, when on intro you don’t get transferred to dashboard, but when clicked/on sign in/on page, you get transferred.

Chat to create tutorial, ask navigation on package; RAG on dashboard



M4 (Red is questionable addition) (Blue means research):
XSS Security, Documentation, Bug list, Test coverage:

UI Polish/UX/Quality of Life:
- Remove sensitive info, guarantee won't be used to train
- Transparency about privacy
- Dependency graph placement/size; cluttered; config; back/accent colour
- Lot of dead space; pagination and subject groupings for pages
- Code snippet, linking (to code or render in app)
- Have those hyperlinks after each claim
- Usability: tours (choose tour), FAQ, font size
- What is analysis complete? Complexity, coverage, test
- Ranking, config
- Sequence diagram, dataflow diagram, user stories, usage stories
- Change package/edit
- Write data to folder to be smarter
- Own API Key
- Windsurf Code Maps: execution flow, component relationship
- Our task is to replace or supplement documentation
- Responsiveness, speed, status
- Different branch, scope, config
- AI Providers expansion, config


Bug fixes:
- In GitHub issues
- What happens when I regenerate the thing I'm currently generating?
- Lost access to GitHub app, should have refresh token
- Refresh query doesn’t refresh repos
- Bug in analysis run tooltip shows results, shouldn’t do that
Preflight preview


Validation/Onboarding Quality (Blue means research):
- Building on the above, I'm unclear on what steps are in place to prevent onboarding packages from being largely different from each other. This could create friction between employees onboarded at different times i.e. with different versions of the repositories if the packages are highly different. In essence, what measures are in place to stop the LLMs' stochasticity to produce largely different (even if accurate in substance) summaries?
- A more general endpoint is easily followed when actually performing tasks. A dummy starter task might also be helpful when onboarding.
- More thorough tutorial
- Why have a ranking of importance in an onboarding doc?
- Clarity/transparency: confidence (clear trust signals)
- Adhering to a format that developers are familiar with will improve it to (i.e. one-line summary, parameters (and any types), returns)
- Onboarding package is graphs and step by step workflows. Explain process and reason behind process. Show code, examples, example usage
- Overwhelming amount of info
- Show what the specific file is doing, what a function does, what sequence of functions it uses to produce result
- Input your responsibility, exercise.
- Flag outdated documentation

Harder tasks/testing:
- Scope testing (result scalability): microservice
- Multiple languages/frameworks
- Workflow detection should be a Call graph
- Accuracy (dependency[imports, module], then functions, then call graph) - file detection
- Hallucination prevention
- Level of sophistication, Technical jargon
300k 5min
2m 10min

M5 (Orange is in the plan):
Maybe:
Maybe just have a single github connection on signup if you are using it, instead of having to connect to your github when adding the repo and signing up.
Stretch: BitBucket, Confluent, Notion, local/bedrock/enterprise models, other providers.
Deployment
