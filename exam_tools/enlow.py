# -*- coding: utf-8 -*-
"""下层内容库：沪教英语版六年级上册（偏难）。

考查范围：be 动词与人称/物主代词、一般现在时、名词单复数、There be、
can、常见介词与疑问词、基础词汇（家庭/学校/食物/颜色/数字）。
偏难体现在多步句型转换、短文首字母填空、稍长的阅读理解与 60 词小作文。
"""

BOOK = '六年级上册'
LEVEL = '下层'

# ---------- 单项选择：(题干, [A,B,C,D], 正确下标, 解析) ----------
MC = [
    ("My sister and I ____ students.", ["am", "is", "are", "be"], 2,
     "主语 My sister and I 是复数，be 动词用 are。故选 C。"),
    ("____ your father a teacher?", ["Is", "Are", "Do", "Does"], 0,
     "主语 your father 是第三人称单数，句中没有实义动词，用 Is 开头。故选 A。"),
    ("There ____ some milk in the glass.", ["is", "are", "have", "has"], 0,
     "milk 是不可数名词，there be 句型中 be 用 is。故选 A。"),
    ("There ____ two books and a pen on the desk.", ["is", "are", "be", "have"], 1,
     "there be 遵循就近原则，靠近 be 的是 two books（复数），故用 are。故选 B。"),
    ("I can ____ a bike.", ["ride", "rides", "riding", "to ride"], 0,
     "情态动词 can 后接动词原形，故用 ride。故选 A。"),
    ("— What colour ____ your shoes? — They ____ black.",
     ["is; is", "are; are", "is; are", "are; is"], 1,
     "shoes 是复数，两处都用 are；答语主语 They 也是复数。故选 B。"),
    ("This is not my ruler. ____ is in my bag.", ["My", "Mine", "Me", "I"], 1,
     "空格后没有名词，要用名词性物主代词 mine，相当于 my ruler。故选 B。"),
    ("Please give the book to ____.", ["I", "me", "my", "mine"], 1,
     "介词 to 后接人称代词的宾格，I 的宾格是 me。故选 B。"),
    ("— ____ is your English teacher? — Miss Wang.", ["What", "Who", "Where", "How"], 1,
     "答语是人名，问人用 Who。故选 B。"),
    ("— ____ students are there in your class? — Forty.",
     ["How much", "How many", "How old", "What"], 1,
     "students 是可数名词复数，问数量用 How many。故选 B。"),
    ("My father ____ a doctor.", ["am", "is", "are", "be"], 1,
     "主语 My father 是第三人称单数，be 动词用 is。故选 B。"),
    ("We ____ to school by bus every day.", ["go", "goes", "going", "are go"], 0,
     "主语 We 是复数，一般现在时用动词原形 go。故选 A。"),
    ("____ there any water in the bottle?", ["Is", "Are", "Do", "Does"], 0,
     "water 不可数，一般疑问句用 Is there 开头。故选 A。"),
    ("There are three ____ on the table.", ["box", "boxes", "boxs", "a box"], 1,
     "three 后接可数名词复数，box 以 x 结尾，复数是 boxes。故选 B。"),
    ("The cat is ____ the table.", ["in", "under", "of", "with"], 1,
     "猫在桌子下面，用 under；in the table 与 of、with 均不合句意。故选 B。"),
    ("— ____ is your little brother? — He is five.",
     ["How old", "How many", "How much", "What"], 0,
     "答语是年龄，问年龄用 How old。故选 A。"),
    ("Tom and Jack ____ good friends.", ["is", "am", "are", "be"], 2,
     "主语 Tom and Jack 是两个人，复数，be 动词用 are。故选 C。"),
    ("Can you ____ English?", ["speak", "speaks", "speaking", "to speak"], 0,
     "情态动词 Can 后接动词原形，说某种语言用 speak。故选 A。"),
    ("Look at that woman. ____ is my mother.", ["She", "Her", "Hers", "He"], 0,
     "空格作主语且指女性，用主格 She。故选 A。"),
    ("There ____ a pen and two books in my bag.", ["is", "are", "have", "has"], 0,
     "there be 遵循就近原则，靠近 be 的是 a pen（单数），故用 is。故选 A。"),
    ("— Where ____ my shoes? — ____ under the bed.",
     ["is; It's", "are; They're", "are; It's", "is; They're"], 1,
     "shoes 是复数，问句用 are；答语用 They're 指代。故选 B。"),
    ("I like apples, but I ____ like bananas.", ["don't", "doesn't", "am not", "not"], 0,
     "主语 I 的一般现在时否定句用 don't 加动词原形。故选 A。"),
    ("— ____ is the weather like today? — It is sunny.",
     ["What", "How", "Where", "Who"], 0,
     "句中有 like，问天气用 What is the weather like。故选 A。"),
    ("My name ____ Lucy. I ____ ten years old.",
     ["is; am", "am; is", "are; am", "is; is"], 0,
     "My name 是第三人称单数用 is；I 后面 be 动词用 am。故选 A。"),
    ("These ____ my parents. ____ are teachers.",
     ["is; He", "are; They", "are; She", "is; They"], 1,
     "These 与 my parents 都是复数，两处分别用 are 和 They。故选 B。"),
    ("What ____ you see in the room?", ["can", "are", "is", "am"], 0,
     "句中已有实义动词 see，只有情态动词 can 能直接接动词原形。故选 A。"),
    ("There is ____ apple and ____ banana on the plate.",
     ["a; a", "an; a", "a; an", "an; an"], 1,
     "apple 以元音音素开头用 an，banana 以辅音音素开头用 a。故选 B。"),
    ("— ____ is the ball? — It is under the chair.",
     ["What", "Who", "Where", "How"], 2,
     "答语是地点，问地点用 Where。故选 C。"),
    ("We ____ a new classroom. It ____ very big.",
     ["have; is", "has; is", "have; are", "has; are"], 0,
     "主语 We 用 have；It 是第三人称单数，be 动词用 is。故选 A。"),
    ("— Is this your pencil? — Yes, ____.",
     ["it is", "it isn't", "this is", "they are"], 0,
     "Is this...? 的肯定回答用 Yes, it is. 故选 A。"),
    ("The map is ____ the wall.", ["in", "on", "under", "of"], 1,
     "地图挂在墙面上用 on the wall。故选 B。"),
    ("— What ____ is it? — It is red.", ["colour", "time", "day", "name"], 0,
     "答语是颜色，问颜色用 What colour。故选 A。"),
    ("I go to school ____ seven o'clock.", ["at", "in", "on", "with"], 0,
     "具体时刻前用介词 at。故选 A。"),
    ("____ name is Peter. ____ am twelve.",
     ["My; I", "I; My", "Me; I", "Mine; I"], 0,
     "修饰名词 name 用形容词性物主代词 My；作主语用 I。故选 A。"),
    ("— Are those your books? — No, ____ aren't.",
     ["they", "it", "those", "these"], 0,
     "Are those...? 的答语用 they 指代复数事物。故选 A。"),
    ("There are ____ days in a week.", ["six", "seven", "eight", "nine"], 1,
     "一周有七天，用 seven。故选 B。"),
]

# ---------- 词汇与词形变化：(题干, 答案)，每个大题 6 空 ----------
VOCAB = [
    ("根据要求填空：\n"
     "   (1) book（复数）__________\n"
     "   (2) I（宾格）__________\n"
     "   (3) she（形容词性物主代词）__________\n"
     "   (4) child（复数）__________\n"
     "   (5) is not（缩写形式）__________\n"
     "   (6) my（名词性物主代词）__________",
     "(1) books　(2) me　(3) her　(4) children　(5) isn't　(6) mine"),
    ("用所给词的适当形式填空：\n"
     "   (1) There are two __________ (box) on the desk.\n"
     "   (2) These are __________ (we) books.\n"
     "   (3) My mother __________ (be) a nurse.\n"
     "   (4) I have three __________ (pen).\n"
     "   (5) __________ (they) classroom is big.\n"
     "   (6) There __________ (be) some water in the cup.",
     "(1) boxes　(2) our　(3) is　(4) pens　(5) Their　(6) is"),
    ("根据汉语提示填空：\n"
     "   (1) 我家里有五口人。There are five __________ in my family.\n"
     "   (2) 这是我的书包。This is __________ schoolbag.\n"
     "   (3) 桌子上有一些面包。There is some __________ on the table.\n"
     "   (4) 她是我姐姐。__________ is my sister.\n"
     "   (5) 你会游泳吗？__________ you swim?\n"
     "   (6) 苹果是红色的。The apples are __________.",
     "(1) people　(2) my　(3) bread　(4) She　(5) Can　(6) red"),
    ("选择合适的词填空（每空一词）：\n"
     "   (1) There __________ a book and two pens in my bag.\n"
     "   (2) — __________ is your bag? — It is under the desk.\n"
     "   (3) I go to school __________ bike.\n"
     "   (4) __________ you like some milk?\n"
     "   (5) Please put your books __________ your schoolbag.\n"
     "   (6) My father __________ a teacher.",
     "(1) is　(2) Where　(3) by　(4) Would　(5) in　(6) is"),
    ("用下列词的适当形式填空：\n"
     "   (1) __________ (be) there any milk in the glass?\n"
     "   (2) The __________ (child) are playing in the park.\n"
     "   (3) This is __________ (I) new bike.\n"
     "   (4) There are many __________ (apple) on the tree.\n"
     "   (5) We __________ (be) in Class Two.\n"
     "   (6) — What are __________ (this)? — They are books.",
     "(1) Is　(2) children　(3) my　(4) apples　(5) are　(6) these"),
    ("根据要求填空：\n"
     "   (1) foot（复数）__________\n"
     "   (2) he（宾格）__________\n"
     "   (3) they（形容词性物主代词）__________\n"
     "   (4) tomato（复数）__________\n"
     "   (5) are not（缩写形式）__________\n"
     "   (6) you（名词性物主代词）__________",
     "(1) feet　(2) him　(3) their　(4) tomatoes　(5) aren't　(6) yours"),
    ("用所给词的适当形式填空：\n"
     "   (1) I have two __________ (knife).\n"
     "   (2) __________ (she) name is Lucy.\n"
     "   (3) There __________ (be) ten students in the room.\n"
     "   (4) These are __________ (they) desks.\n"
     "   (5) My brothers __________ (be) tall.\n"
     "   (6) I can see six __________ (sheep) on the hill.",
     "(1) knives　(2) Her　(3) are　(4) their　(5) are　(6) sheep"),
    ("根据汉语提示填空：\n"
     "   (1) 教室里有四十张课桌。There are forty __________ in the classroom.\n"
     "   (2) 那是她的尺子。That is __________ ruler.\n"
     "   (3) 我喜欢牛奶和面包。I like milk and __________.\n"
     "   (4) 他是我的朋友。__________ is my friend.\n"
     "   (5) 你的书包是什么颜色的？What __________ is your bag?\n"
     "   (6) 请把书放在桌子上。Please put the book __________ the desk.",
     "(1) desks　(2) her　(3) bread　(4) He　(5) colour　(6) on"),
    ("选择合适的词填空（每空一词）：\n"
     "   (1) __________ there two cats under the tree?\n"
     "   (2) — __________ old is your sister? — She is nine.\n"
     "   (3) We have lunch __________ twelve o'clock.\n"
     "   (4) __________ I help you?\n"
     "   (5) The picture is __________ the wall.\n"
     "   (6) These __________ my new books.",
     "(1) Are　(2) How　(3) at　(4) Can　(5) on　(6) are"),
    ("用下列词的适当形式填空：\n"
     "   (1) Are __________ (that) your pencils?\n"
     "   (2) There is some __________ (bread) on the plate.\n"
     "   (3) __________ (we) teacher is Miss Li.\n"
     "   (4) I can see five __________ (bird) in the tree.\n"
     "   (5) __________ (be) you a student?\n"
     "   (6) The __________ (woman) are nurses.",
     "(1) those　(2) bread　(3) Our　(4) birds　(5) Are　(6) women"),
]

# ---------- 情景交际：(题干, 参考答案) ----------
COMM = [
    ("— How are you?\n   — ______", "I'm fine, thank you."),
    ("— What's your name?\n   — ______", "My name is Peter."),
    ("— How old are you?\n   — ______", "I'm twelve years old."),
    ("— Where is my book?\n   — ______", "It's on the desk."),
    ("— What colour is your bag?\n   — ______", "It's blue."),
    ("— Thank you very much.\n   — ______", "You're welcome."),
    ("— Can I help you?\n   — ______", "Yes, please. I want a pencil."),
    ("— How do you go to school?\n   — ______", "I go to school by bike."),
    ("— Is this your ruler?\n   — ______", "Yes, it is. Thank you."),
    ("— How many students are there in your class?\n   — ______", "There are forty students in my class."),
    ("— Nice to meet you.\n   — ______", "Nice to meet you, too."),
    ("— What time do you get up?\n   — ______", "I get up at six thirty."),
    ("— Who is that girl?\n   — ______", "She is my sister."),
    ("— Would you like some milk?\n   — ______", "Yes, please."),
    ("— Can you swim?\n   — ______", "Yes, I can."),
    ("— What is your father?\n   — ______", "He is a doctor."),
    ("— Where are my shoes?\n   — ______", "They are under the bed."),
    ("— Are those your books?\n   — ______", "No, they aren't."),
    ("— Have a good day!\n   — ______", "Thank you. You too."),
    ("— What is in your schoolbag?\n   — ______", "There are some books and a pencil box in it."),
]

# ---------- 阅读理解：(标题, 短文, [(问题, 参考答案) x6]) ----------
READING = [
    ("My Family",
     "My name is Anna. I am eleven years old and I live in a small town with my family. "
     "There are four people in my family: my father, my mother, my little brother and me. "
     "My father is a driver. He gets up early every morning and drives a bus. My mother is a cook "
     "in a school. She makes lunch for the students. My little brother is only six. He goes to a "
     "small school near our home and he likes toy cars very much.\n"
     "We have a small house with a garden. There are two apple trees in the garden. In autumn we "
     "pick the apples together. On Sundays we do not go to work or school. We clean the house in "
     "the morning and visit my grandparents in the afternoon. My grandma always makes a big cake "
     "for us. I love my family because we help each other every day.",
     [("How many people are there in Anna's family?", "There are four people in her family."),
      ("What does Anna's father do?", "He is a driver. He drives a bus."),
      ("How old is Anna's little brother?", "He is six years old."),
      ("What is in the garden?", "There are two apple trees in the garden."),
      ("When do they visit Anna's grandparents?", "On Sunday afternoon."),
      ("Why does Anna love her family?", "Because they help each other every day.")]),

    ("My School Day",
     "I am Ben and I am twelve. I get up at six thirty every morning. I wash my face, brush my "
     "teeth and have breakfast with my parents. I usually have bread, an egg and a glass of milk. "
     "Then I go to school by bike at seven o'clock.\n"
     "Our school is not far from my home. There are thirty-six students in my class. Classes begin "
     "at eight. We have four lessons in the morning and two in the afternoon. My favourite subject "
     "is PE, because I like running and playing football. At twelve we have lunch in the school "
     "dining hall. School finishes at four thirty. After school I play ball games with my friends "
     "for half an hour. I get home at five and do my homework before dinner.",
     [("What time does Ben get up?", "He gets up at six thirty."),
      ("What does Ben have for breakfast?", "He has bread, an egg and a glass of milk."),
      ("How does Ben go to school?", "He goes to school by bike."),
      ("How many students are there in Ben's class?", "There are thirty-six students."),
      ("Why does Ben like PE?", "Because he likes running and playing football."),
      ("What does Ben do before dinner?", "He does his homework before dinner.")]),

    ("Our Classroom",
     "Our classroom is on the second floor. It is big and bright. There are two big windows on "
     "the left, so the room is full of light in the morning. There are forty desks and forty chairs "
     "in it. The teacher's desk is in front of the blackboard.\n"
     "On the wall near the door there is a small board. We put our timetable and some beautiful "
     "pictures on it. There is also a bookcase at the back of the room. Many storybooks are in it, "
     "and we can take them home on Fridays. There is no computer in our classroom, but we do not "
     "mind. We clean the classroom every afternoon. Everyone in my class likes this room, because "
     "it is tidy and warm, just like a second home.",
     [("Where is the classroom?", "It is on the second floor."),
      ("How many desks are there in the classroom?", "There are forty desks."),
      ("What is on the small board?", "The timetable and some beautiful pictures."),
      ("What is at the back of the room?", "There is a bookcase at the back of the room."),
      ("When can the students take storybooks home?", "On Fridays."),
      ("Why do the students like the classroom?", "Because it is tidy and warm.")]),

    ("My Best Friend",
     "My best friend is Lucy. She is twelve years old, the same age as me. She has long black "
     "hair and big eyes. She is tall and she always wears a blue coat in winter. Lucy is kind and "
     "quiet, but she smiles a lot.\n"
     "Lucy lives near my home, so we go to school together every morning. We are in the same "
     "class. She is good at English and often helps me with new words. I am good at maths, so I "
     "help her with numbers. At the weekend we ride bikes in the park or read books in the "
     "library. Sometimes we make fruit salad at her home. Her mother says we are like two "
     "sisters. I am very happy to have such a good friend.",
     [("How old is Lucy?", "She is twelve years old."),
      ("What does Lucy look like?", "She has long black hair and big eyes, and she is tall."),
      ("What is Lucy good at?", "She is good at English."),
      ("What does the writer help Lucy with?", "The writer helps her with maths and numbers."),
      ("What do they do at the weekend?", "They ride bikes in the park or read books in the library."),
      ("What does Lucy's mother say?", "She says the two girls are like two sisters.")]),

    ("A Small Shop",
     "There is a small shop near our school. It is not big, but it has many things. Two women "
     "work there. They are friendly and they know most of the students by name.\n"
     "In the shop you can buy bread, milk, eggs, apples and bananas. There are also pens, "
     "notebooks and colour pencils for school. The bread is fresh every morning and the apples "
     "are sweet. I often go there with my classmates after school. I buy a bottle of water and "
     "some bread. My friend Jack always buys a small cake. The shop opens at seven in the morning "
     "and closes at six in the afternoon. On Sundays it is closed, so we cannot buy anything there.",
     [("Where is the small shop?", "It is near the school."),
      ("How many people work in the shop?", "Two women work there."),
      ("What school things can you buy in the shop?", "Pens, notebooks and colour pencils."),
      ("What does the writer often buy there?", "A bottle of water and some bread."),
      ("When does the shop close?", "It closes at six in the afternoon."),
      ("Why can't they buy anything there on Sundays?", "Because the shop is closed on Sundays.")]),

    ("My Pet Cat",
     "We have a cat at home. Her name is Mimi and she is three years old. She is white with a "
     "grey tail. Her eyes are green and very bright at night. Mimi is a quiet cat, but she runs "
     "fast when she sees a ball.\n"
     "Every morning she sits near the door and waits for my father. In the afternoon she sleeps "
     "under the sofa. Her favourite food is fish, and she also likes warm milk. My little sister "
     "gives her a small bowl of milk every day. Mimi does not like water, so we never wash her "
     "with cold water. At night she sleeps on a soft chair in my room. I like to read books with "
     "Mimi beside me. She is not only a pet but also a member of our family.",
     [("How old is Mimi?", "She is three years old."),
      ("What colour are Mimi's eyes?", "They are green."),
      ("Where does Mimi sleep in the afternoon?", "She sleeps under the sofa."),
      ("What is Mimi's favourite food?", "Her favourite food is fish."),
      ("Why do they never wash Mimi with cold water?", "Because Mimi does not like water."),
      ("Where does Mimi sleep at night?", "She sleeps on a soft chair in the writer's room.")]),

    ("The Park Near My Home",
     "There is a small park near my home. It is only five minutes' walk from my house, so I go "
     "there almost every day. The park is not large, but it is clean and green. There are many "
     "trees and a few benches along the paths.\n"
     "In the middle of the park there is a round flower bed. In spring there are red and yellow "
     "flowers in it. Many old people sit on the benches and talk. Some children fly kites on the "
     "grass. There is also a small table for table tennis, and my brother and I often play there "
     "after school. We must not pick the flowers or walk on the grass. I like this park because "
     "it is quiet and everyone is friendly.",
     [("How far is the park from the writer's home?", "It is only five minutes' walk."),
      ("What is in the middle of the park?", "There is a round flower bed."),
      ("What colours are the flowers in spring?", "They are red and yellow."),
      ("What do some children do on the grass?", "They fly kites."),
      ("What must people not do in the park?", "They must not pick the flowers or walk on the grass."),
      ("Why does the writer like the park?", "Because it is quiet and everyone is friendly.")]),

    ("My Grandparents' Farm",
     "My grandparents live on a small farm in the countryside. Every summer I stay with them for "
     "two weeks. Their house is old but very comfortable, and there is a big garden behind it.\n"
     "There are ten chickens, two cows and a horse on the farm. Every morning my grandpa gives "
     "the animals their food. My grandma grows tomatoes, potatoes and cabbages in the garden. "
     "The vegetables are fresh, so our meals are always delicious. There is a small river near "
     "the farm. In the afternoon I sometimes sit by the river and watch the fish. There is no "
     "television in the house, but I am never bored. I help in the garden, read books and listen "
     "to my grandpa's stories. Those two weeks are the happiest time of my summer.",
     [("How long does the writer stay on the farm?", "For two weeks every summer."),
      ("How many cows are there on the farm?", "There are two cows."),
      ("What does Grandma grow in the garden?", "Tomatoes, potatoes and cabbages."),
      ("What is near the farm?", "There is a small river near the farm."),
      ("Why are the meals delicious?", "Because the vegetables are fresh."),
      ("Why is the writer never bored?", "Because he or she helps in the garden, reads books and listens to stories.")]),

    ("Breakfast Time",
     "Breakfast is the most important meal in our family. We always get up early and sit together "
     "at the table. My mother makes different food every day. On Monday we have bread and eggs. "
     "On Tuesday we have noodles. On Wednesday there is rice soup with vegetables. My father "
     "likes milk and my sister likes orange juice. I like both.\n"
     "There is a small white cat in our home. It sits under the table and waits quietly. We never "
     "give it our food, because our mother says human food is not good for cats. After breakfast "
     "my father reads the newspaper for ten minutes. Then my sister and I put on our schoolbags "
     "and go to school. My mother cleans the table. These twenty minutes in the morning are short, "
     "but they make every day a good day.",
     [("Which meal is the most important in the family?", "Breakfast."),
      ("What do they have on Tuesday?", "They have noodles."),
      ("What does the writer's sister like?", "She likes orange juice."),
      ("Why do they never give the cat their food?", "Because human food is not good for cats."),
      ("What does the father do after breakfast?", "He reads the newspaper for ten minutes."),
      ("Who cleans the table?", "The writer's mother cleans the table.")]),

    ("My New Schoolbag",
     "Last week my mother bought me a new schoolbag. It is dark blue and it is not very big, but "
     "I like it very much. There is a small picture of a white cloud on the front.\n"
     "The bag has three pockets. I put my books and notebooks in the big one. In the middle "
     "pocket there is my pencil box, with two pens, a ruler and an eraser in it. I put my water "
     "bottle in the side pocket, so it never falls on my books. There is also a small pocket for "
     "my keys. Every evening I put my homework in the bag before I go to bed, so I never forget "
     "it in the morning. My friends say my bag is cool. I think it is more than a bag: it carries "
     "all my school things and helps me every day.",
     [("What colour is the new schoolbag?", "It is dark blue."),
      ("How many pockets does the bag have?", "It has three pockets."),
      ("What is in the pencil box?", "Two pens, a ruler and an eraser."),
      ("Where does the writer put the water bottle?", "In the side pocket."),
      ("When does the writer put the homework in the bag?", "Every evening before going to bed."),
      ("Why does the writer like the bag?", "Because it carries all the school things and helps every day.")]),

    ("A Rainy Morning",
     "It was a rainy morning, so I could not ride my bike to school. I put on my yellow raincoat "
     "and took a big umbrella. My mother went with me to the bus stop. There were many people "
     "there, and everyone had an umbrella.\n"
     "The bus came at seven twenty. It was warm inside, but the windows were wet, so I could not "
     "see the shops clearly. At school I put my wet umbrella in a corner of the classroom. Our "
     "teacher opened the windows a little and told us to keep our books dry. In the second lesson "
     "the rain stopped and the sun came out. The playground was full of small pools, but we could "
     "not go out during the break. I did not mind. I like rainy mornings, because the air is "
     "clean and the trees look fresh and green.",
     [("Why couldn't the writer ride a bike to school?", "Because it was a rainy morning."),
      ("Who went with the writer to the bus stop?", "The writer's mother."),
      ("What time did the bus come?", "It came at seven twenty."),
      ("Where did the writer put the wet umbrella?", "In a corner of the classroom."),
      ("What did the teacher tell the students to do?", "To keep their books dry."),
      ("Why does the writer like rainy mornings?", "Because the air is clean and the trees look fresh and green.")]),

    ("My English Teacher",
     "Miss Chen is our English teacher. She is twenty-eight years old and she comes from a city "
     "in the south. She is not tall, and she always wears a smile. Her voice is soft, so everyone "
     "listens carefully in her class.\n"
     "Miss Chen makes English interesting. She often brings picture cards to class and asks us to "
     "say the new words. Sometimes we sing English songs or play a word game in groups. She never "
     "shouts when we make mistakes. Instead she says, 'Try again, please.' After class she stays "
     "in the classroom and answers our questions. There is a small red book on her desk. She "
     "writes down every good sentence we make in it. All of us like her, because she is patient "
     "and she makes us feel brave enough to speak English.",
     [("How old is Miss Chen?", "She is twenty-eight years old."),
      ("What does Miss Chen often bring to class?", "Picture cards."),
      ("What do the students sometimes do in class?", "They sing English songs or play a word game."),
      ("What does Miss Chen say when students make mistakes?", "She says, 'Try again, please.'"),
      ("What is in the small red book?", "Every good sentence the students make."),
      ("Why do the students like Miss Chen?", "Because she is patient and makes them brave enough to speak English.")]),

    ("Two Brothers",
     "Peter and Sam are brothers, but they are very different. Peter is fourteen and Sam is ten. "
     "Peter is tall and quiet. He likes reading and he spends a lot of time in the library. Sam is "
     "short and lively. He likes football and he runs in the garden every afternoon.\n"
     "Their room has two beds, two desks and one big window. Peter's desk is always tidy, with "
     "his books in a neat line. Sam's desk is full of toy cars, balls and coloured paper. Their "
     "mother often asks Sam to clean it. On Saturday morning the two brothers clean the room "
     "together. Then Peter reads a story to Sam, and Sam tells Peter about his football game. "
     "They sometimes quarrel, but they are good friends again in a minute. Their mother says a "
     "family is like a team: everyone is different, and everyone is needed.",
     [("How old is Sam?", "He is ten years old."),
      ("What does Peter like doing?", "He likes reading and spending time in the library."),
      ("What is on Sam's desk?", "Toy cars, balls and coloured paper."),
      ("When do the brothers clean their room?", "On Saturday morning."),
      ("What does Peter do after cleaning?", "He reads a story to Sam."),
      ("What does their mother say about a family?", "She says a family is like a team and everyone is needed.")]),

    ("The School Library",
     "Our school library is on the first floor, next to the teachers' office. It is open from "
     "eight in the morning to five in the afternoon. There are long tables and many brown "
     "bookshelves in it. More than two thousand books stand on the shelves.\n"
     "There are storybooks, picture books, science books and dictionaries. We can borrow two "
     "books at a time and keep them for two weeks. We must write our names in a small notebook at "
     "the desk. In the library we must keep quiet and we must not eat or drink. Miss Wu, the "
     "librarian, is always ready to help us find a book. Every Thursday afternoon our class has "
     "a reading lesson there. I usually sit by the window. It is the quietest and nicest place in "
     "our school.",
     [("Where is the school library?", "It is on the first floor, next to the teachers' office."),
      ("When is the library open?", "From eight in the morning to five in the afternoon."),
      ("How many books can a student borrow at a time?", "Two books."),
      ("What must students do before taking a book?", "They must write their names in a small notebook."),
      ("What must students not do in the library?", "They must not eat or drink, and they must keep quiet."),
      ("When does the class have a reading lesson there?", "Every Thursday afternoon.")]),

    ("A Visit to the Zoo",
     "Last Sunday our class visited the city zoo. We went there by bus at eight in the morning. "
     "The zoo is big and there are many trees along the paths, so it is cool even in summer.\n"
     "First we saw the monkeys. They jumped from tree to tree and made funny faces. Then we "
     "watched two big elephants. A keeper gave them bananas and told us that elephants have very "
     "good memories. Near the lake there were six white swans. They swam slowly and looked quiet "
     "and beautiful. My favourite animals were the pandas. There were two of them, and they sat "
     "eating bamboo all the time. We took no photos of them, because the keeper asked us to keep "
     "the place quiet. At four o'clock we went back to school, tired but very happy.",
     [("How did the class go to the zoo?", "They went there by bus."),
      ("What did the monkeys do?", "They jumped from tree to tree and made funny faces."),
      ("What did the keeper tell the students about elephants?", "That elephants have very good memories."),
      ("How many white swans were there near the lake?", "There were six."),
      ("Why didn't they take photos of the pandas?", "Because the keeper asked them to keep the place quiet."),
      ("How did they feel when they went back?", "They felt tired but very happy.")]),

    ("My Favourite Food",
     "My favourite food is tomato and egg noodles. My mother often cooks them for me at the "
     "weekend. She cuts two tomatoes into small pieces and beats three eggs in a bowl. Then she "
     "cooks them together in a pot with a little oil. The kitchen smells wonderful.\n"
     "There is a small bowl of green vegetables on the table, too. My mother says a good meal "
     "needs both colour and taste. I can eat a big bowl of noodles, but my little sister can only "
     "eat a small one. She likes the eggs more than the noodles. After the meal we wash the bowls "
     "together. I do not like fast food very much. To me the best food is simple, hot and made at "
     "home. When I grow up, I want to learn to cook these noodles for my parents.",
     [("What is the writer's favourite food?", "Tomato and egg noodles."),
      ("When does the mother cook them?", "At the weekend."),
      ("How many eggs does she beat in a bowl?", "Three eggs."),
      ("What does the mother say a good meal needs?", "Both colour and taste."),
      ("What does the little sister like more?", "She likes the eggs more than the noodles."),
      ("What does the writer want to do when he or she grows up?", "To learn to cook these noodles for the parents.")]),

    ("Colours in My Room",
     "My room is small, but it is full of colours. The walls are light yellow, and the door is "
     "green. There is a blue bed near the window and a white desk beside it. On the desk there is "
     "a red lamp. I do my homework under it every evening.\n"
     "I like blue best, because it makes me feel calm. My quilt is blue and so is my schoolbag. "
     "There are some colour pencils in a box on the shelf. I use them to draw pictures of my "
     "family and my cat. There is a big map on the wall, with many blue seas and green lands on "
     "it. My mother sometimes says my room is too colourful. I do not agree. A room with many "
     "colours is a happy room, and I like to sit in it and read after school.",
     [("What colour are the walls?", "They are light yellow."),
      ("Where is the white desk?", "It is beside the blue bed."),
      ("Why does the writer like blue best?", "Because it makes the writer feel calm."),
      ("What does the writer draw with the colour pencils?", "Pictures of the family and the cat."),
      ("What is on the wall?", "A big map with blue seas and green lands."),
      ("What does the writer like to do in the room after school?", "To sit in it and read.")]),

    ("A Letter to a Friend",
     "Dear Kate,\n"
     "How are you? I am writing to tell you about my new school. It is bigger than my old one, "
     "and there are three tall buildings in it. My classroom is on the third floor. There are "
     "forty-two students in my class, and all of them are friendly.\n"
     "My favourite place is the small garden behind the library. There are some benches under the "
     "trees, and I often read there at noon. Our teachers are kind, but we have more homework "
     "than before. I am in the school music club now. We meet every Wednesday afternoon and sing "
     "together. Please write to me soon and tell me about your new class. I hope we can meet in "
     "the summer holiday.\n"
     "Yours,\n"
     "Linda",
     [("Who is the letter to?", "It is to Kate."),
      ("How many buildings are there in Linda's new school?", "There are three."),
      ("Where is Linda's classroom?", "It is on the third floor."),
      ("What is Linda's favourite place?", "The small garden behind the library."),
      ("When does the music club meet?", "Every Wednesday afternoon."),
      ("What does Linda hope?", "She hopes they can meet in the summer holiday.")]),

    ("A Busy Saturday",
     "Saturday is the busiest day of my week. I get up at seven and help my father clean the car. "
     "Then I do my homework for two hours. At eleven I go to the market with my mother. We buy "
     "vegetables, fruit and some bread for the next day.\n"
     "In the afternoon I have a music lesson. I am learning to play the piano, and I practise for "
     "an hour every day. After the lesson I play table tennis with my cousin in the park. In the "
     "evening our family has a big dinner together. My grandpa comes, too. After dinner I wash "
     "the bowls with my sister, and then we watch a film for half an hour. I go to bed at nine "
     "thirty. I am tired on Saturday night, but I like this day, because I do many different "
     "things and I am with my family.",
     [("What does the writer do at seven on Saturday?", "He or she gets up and helps clean the car."),
      ("What do they buy at the market?", "Vegetables, fruit and some bread."),
      ("What is the writer learning in the afternoon?", "To play the piano."),
      ("Who does the writer play table tennis with?", "With his or her cousin."),
      ("What does the writer do after dinner?", "Washes the bowls and watches a film."),
      ("Why does the writer like Saturday?", "Because of the many different things and the time with family.")]),

    ("The School Bus",
     "I go to school by school bus every morning. The bus is yellow and it stops at the corner of "
     "my street at seven ten. Mr Brown is the driver. He is a tall man with a kind face, and he "
     "always says good morning to us.\n"
     "There are about twenty children on the bus. Some of them are from my class. We sit two in a "
     "seat and talk about our homework or our teachers. The bus passes a small park, a bookshop "
     "and a white bridge. The ride takes twenty minutes. We must stay in our seats and we must "
     "not put our hands out of the windows. Mr Brown never drives fast. When we get to school, he "
     "says, 'Have a nice day!' I like the school bus, because the ride is short and I am with my "
     "friends.",
     [("What time does the bus stop at the corner?", "At seven ten."),
      ("Who is the driver?", "Mr Brown."),
      ("How many children are on the bus?", "About twenty children."),
      ("What does the bus pass?", "A small park, a bookshop and a white bridge."),
      ("What must the children not do on the bus?", "They must not put their hands out of the windows."),
      ("Why does the writer like the school bus?", "Because the ride is short and the writer is with friends.")]),
]

# ---------- 书面表达：(题干, [(评分项, 分值)], 参考范文) ----------
RUBRIC = [
    ("内容切合题意，要点齐全", 15),
    ("语言基本正确，句子通顺", 15),
    ("不少于 50 词，词数在 60 词左右", 5),
    ("书写整洁，标点与大小写正确", 5),
]

WRITING = [
    ("Please write a short passage of about 60 words about your family. "
     "You should say how many people are in your family, what they do and what you do together "
     "at the weekend.",
     RUBRIC,
     "There are four people in my family: my father, my mother, my sister and me. My father is a "
     "doctor and my mother is a teacher. My sister is eight. At the weekend we clean the house "
     "together. In the afternoon we go to the park and fly a kite. In the evening my mother cooks "
     "a big dinner. I love my family, because we always help each other."),
    ("Please write a short passage of about 60 words about your school day. "
     "You should say when you get up, how you go to school and what your favourite subject is.",
     RUBRIC,
     "I get up at six thirty every morning. I have bread and milk for breakfast, then I go to "
     "school by bike at seven. Classes begin at eight. My favourite subject is PE, because I like "
     "playing football. We have lunch at school at twelve. School finishes at four thirty. After "
     "school I do my homework and read a storybook. My school day is busy but happy."),
    ("Please write a short passage of about 60 words about your favourite food. "
     "You should say what it is, when you eat it and why you like it.",
     RUBRIC,
     "My favourite food is tomato and egg noodles. My mother cooks them at the weekend. She cuts "
     "two tomatoes and beats three eggs, then cooks them together. I eat a big bowl for lunch. I "
     "like this food because it is hot, fresh and full of colour. My little sister likes the eggs, "
     "too. To me the best food is simple food made at home by my mother."),
    ("Please write a short passage of about 60 words about your best friend. "
     "You should say who your friend is, what he or she looks like and what you do together.",
     RUBRIC,
     "My best friend is Lucy. She is twelve. She has long black hair and big eyes, and she is "
     "tall. She is kind and quiet, but she smiles a lot. We are in the same class and go to school "
     "together every morning. She helps me with English and I help her with maths. At the weekend "
     "we ride bikes in the park. I am happy to have such a good friend."),
]
