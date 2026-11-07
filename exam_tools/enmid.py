# -*- coding: utf-8 -*-
"""中层内容库：沪教英语版七年级上册（偏难）。

考查范围：一般现在时第三人称单数、现在进行时、一般过去时入门、
可数与不可数名词、some / any、情态动词 can / must、比较级入门、
频度副词、日常情景交际。偏难体现在时态混合辨析、完形填空式阅读、
语法综合填空与 80 词应用文写作。
"""

BOOK = '七年级上册'
LEVEL = '中层'

MC = [
    ("My sister ____ to school by bike every day.", ["go", "goes", "going", "is go"], 1,
     "every day 提示一般现在时，主语 My sister 是第三人称单数，动词用 goes。故选 B。"),
    ("He ____ his homework after dinner every evening.", ["do", "does", "is do", "doing"], 1,
     "every evening 提示一般现在时，第三人称单数用 does。故选 B。"),
    ("Look! The boys ____ football on the playground.",
     ["play", "plays", "are playing", "played"], 2,
     "Look! 提示现在进行时，主语 The boys 是复数，用 are playing。故选 C。"),
    ("— ____ you ____ your homework now? — Yes, I am.",
     ["Do; do", "Are; doing", "Are; do", "Do; doing"], 1,
     "答语 Yes, I am 提示问句用 Are you doing。故选 B。"),
    ("There ____ some milk and two eggs in the fridge.", ["is", "are", "be", "have"], 0,
     "there be 就近原则，靠近 be 的是不可数名词 milk，故用 is。故选 A。"),
    ("We ____ any bread at home. Let's buy some.",
     ["don't have", "doesn't have", "isn't have", "aren't have"], 0,
     "主语 We 是复数，一般现在时否定句用 don't have。故选 A。"),
    ("My mother ____ TV every evening.", ["watch", "watches", "watching", "is watch"], 1,
     "every evening 提示一般现在时，第三人称单数用 watches。故选 B。"),
    ("Tom is ____ than his brother.", ["tall", "taller", "tallest", "the taller"], 1,
     "than 前用比较级 taller。故选 B。"),
    ("He ____ goes to bed late, so he is always sleepy in class.",
     ["never", "often", "is often", "does often"], 1,
     "由后半句可知他经常晚睡，用频度副词 often；频度副词直接放在实义动词前。故选 B。"),
    ("— Must I finish the work now? — No, you ____.",
     ["mustn't", "needn't", "can't", "shouldn't"], 1,
     "Must I...? 的否定回答用 No, you needn't. 表示不必。故选 B。"),
    ("I ____ to the park last Sunday.", ["go", "goes", "went", "am going"], 2,
     "last Sunday 提示一般过去时，go 的过去式是 went。故选 C。"),
    ("There ____ a football match on the playground yesterday.",
     ["is", "are", "was", "were"], 2,
     "yesterday 提示过去时，a football match 是单数，用 was。故选 C。"),
    ("She ____ English very well.", ["speak", "speaks", "speaking", "is speak"], 1,
     "主语 She 是第三人称单数，一般现在时用 speaks。故选 B。"),
    ("Would you like ____ tea?", ["some", "any", "a", "many"], 0,
     "Would you like...? 表示委婉邀请，用 some 而不用 any；tea 不可数不能用 a 或 many。故选 A。"),
    ("There aren't ____ students in the classroom now.",
     ["some", "any", "a", "much"], 1,
     "否定句中修饰可数名词复数用 any。故选 B。"),
    ("My brother is good at ____.", ["swim", "swims", "swimming", "to swim"], 2,
     "be good at 后接动名词，swim 的动名词是 swimming。故选 C。"),
    ("____ your father ____ to work by car?",
     ["Does; go", "Do; go", "Does; goes", "Is; go"], 0,
     "主语 your father 是第三人称单数，疑问句用 Does 开头，动词还原为 go。故选 A。"),
    ("This box is ____ than that one.", ["heavy", "heavier", "heaviest", "more heavy"], 1,
     "than 前用比较级，heavy 的比较级是 heavier。故选 B。"),
    ("We have ____ homework today, so I can't go out.",
     ["many", "a few", "much", "a number of"], 2,
     "homework 是不可数名词，用 much 修饰。故选 C。"),
    ("Listen! Someone ____ in the next room.",
     ["sing", "sings", "is singing", "sang"], 2,
     "Listen! 提示动作正在进行，用 is singing。故选 C。"),
    ("He usually ____ up at six, but yesterday he ____ up at seven.",
     ["gets; gets", "gets; got", "got; gets", "got; got"], 1,
     "usually 用一般现在时 gets；yesterday 用过去时 got。故选 B。"),
    ("— ____ is the red coat? — Ninety yuan.",
     ["How many", "How much", "How long", "How often"], 1,
     "答语是价格，问价钱用 How much。故选 B。"),
    ("I ____ my grandparents last weekend.",
     ["visit", "visits", "visited", "am visiting"], 2,
     "last weekend 提示一般过去时，用 visited。故选 C。"),
    ("There is ____ water in the bottle. Please get some.",
     ["little", "a little", "few", "a few"], 0,
     "water 不可数，且后句说要去买，说明几乎没有，用 little。故选 A。"),
    ("My friend ____ basketball twice a week.",
     ["play", "plays", "is playing", "played"], 1,
     "twice a week 表习惯性动作，用一般现在时，第三人称单数 plays。故选 B。"),
    ("— What ____ you ____ last night? — I watched a film.",
     ["do; do", "did; do", "did; did", "are; doing"], 1,
     "last night 提示一般过去时，疑问句用 did 加动词原形 do。故选 B。"),
    ("— ____ do you go to the library? — Twice a week.",
     ["How long", "How often", "How soon", "How far"], 1,
     "答语是频率，问频率用 How often。故选 B。"),
    ("She is ____ girl in our class.",
     ["tall", "taller", "the tallest", "tallest"], 2,
     "in our class 表示三者以上的范围，用 the tallest。故选 C。"),
    ("Can you ____ me the way to the station?",
     ["tell", "tells", "telling", "to tell"], 0,
     "情态动词 Can 后接动词原形 tell。故选 A。"),
    ("We must ____ the classroom clean.",
     ["keep", "keeps", "keeping", "to keep"], 0,
     "must 后接动词原形，keep the classroom clean 意为保持教室干净。故选 A。"),
    ("My father often ____ newspapers after dinner.",
     ["read", "reads", "reading", "is read"], 1,
     "often 提示一般现在时，第三人称单数用 reads。故选 B。"),
    ("— Where ____ you yesterday afternoon? — I ____ at home.",
     ["are; am", "were; was", "was; were", "were; were"], 1,
     "yesterday 提示过去时，you 用 were，I 用 was。故选 B。"),
    ("There ____ some students and a teacher in the room.",
     ["is", "are", "was", "be"], 1,
     "there be 就近原则，靠近 be 的是 some students（复数），用 are。故选 B。"),
    ("I like maths, but my sister ____ it.",
     ["doesn't like", "don't like", "isn't like", "not like"], 0,
     "主语 my sister 是第三人称单数，否定句用 doesn't like。故选 A。"),
    ("He runs ____ than me.", ["fast", "faster", "fastest", "more fast"], 1,
     "than 前用比较级 faster。故选 B。"),
    ("— Would you like to go shopping with me? — ____",
     ["Yes, I'd love to.", "Yes, I do.", "No, I don't.", "Yes, I am."], 0,
     "Would you like to...? 的肯定回答用 Yes, I'd love to. 故选 A。"),
]

VOCAB = [
    ("根据要求填空：\n"
     "   (1) go（第三人称单数）__________\n"
     "   (2) child（复数）__________\n"
     "   (3) big（比较级）__________\n"
     "   (4) have（第三人称单数）__________\n"
     "   (5) swim（现在分词）__________\n"
     "   (6) good（最高级）__________",
     "(1) goes　(2) children　(3) bigger　(4) has　(5) swimming　(6) best"),
    ("用所给词的适当形式填空：\n"
     "   (1) My brother __________ (watch) TV every evening.\n"
     "   (2) Look! The girls __________ (dance) in the hall.\n"
     "   (3) There __________ (be) some milk in the glass.\n"
     "   (4) I __________ (visit) my uncle last Sunday.\n"
     "   (5) This bag is __________ (heavy) than that one.\n"
     "   (6) We __________ (not have) any bread at home.",
     "(1) watches　(2) are dancing　(3) is　(4) visited　(5) heavier　(6) don't have"),
    ("根据汉语提示填空：\n"
     "   (1) 他每天六点起床。He __________ up at six every day.\n"
     "   (2) 杯子里有一些水。There is __________ water in the cup.\n"
     "   (3) 请安静，婴儿正在睡觉。Please be quiet. The baby __________ __________.\n"
     "   (4) 我昨天去了公园。I __________ to the park yesterday.\n"
     "   (5) 这本书比那本更有趣。This book is __________ interesting than that one.\n"
     "   (6) 你多久锻炼一次？__________ __________ do you exercise?",
     "(1) gets　(2) some　(3) is sleeping　(4) went　(5) more　(6) How often"),
    ("选择合适的词填空（每空一词）：\n"
     "   (1) There isn't __________ milk in the fridge.\n"
     "   (2) Tom is the __________ boy in our class.\n"
     "   (3) He __________ goes to school by bus, but today he walks.\n"
     "   (4) We __________ keep the classroom clean.\n"
     "   (5) I __________ to the park with my friends last night.\n"
     "   (6) __________ you like some orange juice?",
     "(1) any　(2) tallest　(3) usually　(4) must　(5) went　(6) Would"),
    ("用下列词的适当形式填空：\n"
     "   (1) __________ (be) there any apples on the tree?\n"
     "   (2) My father __________ (not like) coffee.\n"
     "   (3) Listen! The bird __________ (sing) in the tree.\n"
     "   (4) There are many __________ (knife) in the kitchen.\n"
     "   (5) She is the __________ (good) student in our class.\n"
     "   (6) We __________ (be) in the park yesterday.",
     "(1) Are　(2) doesn't like　(3) is singing　(4) knives　(5) best　(6) were"),
    ("根据要求填空：\n"
     "   (1) study（第三人称单数）__________\n"
     "   (2) foot（复数）__________\n"
     "   (3) thin（比较级）__________\n"
     "   (4) go（过去式）__________\n"
     "   (5) run（现在分词）__________\n"
     "   (6) many（比较级）__________",
     "(1) studies　(2) feet　(3) thinner　(4) went　(5) running　(6) more"),
    ("用所给词的适当形式填空：\n"
     "   (1) Miss Li __________ (teach) us English.\n"
     "   (2) Be quiet! The baby __________ (sleep).\n"
     "   (3) There __________ (be) two cats under the tree.\n"
     "   (4) I __________ (buy) a new bag last week.\n"
     "   (5) This story is __________ (interesting) than that one.\n"
     "   (6) He __________ (not go) to school last Sunday.",
     "(1) teaches　(2) is sleeping　(3) are　(4) bought　(5) more interesting　(6) didn't go"),
    ("根据汉语提示填空：\n"
     "   (1) 她经常在周末帮忙做家务。She often __________ with the housework at weekends.\n"
     "   (2) 冰箱里没有鸡蛋了。There aren't __________ eggs in the fridge.\n"
     "   (3) 看！他们正在打篮球。Look! They __________ __________ basketball.\n"
     "   (4) 我上周参观了博物馆。I __________ the museum last week.\n"
     "   (5) 他比我跑得快。He runs __________ than me.\n"
     "   (6) 你必须按时到校。You __________ get to school on time.",
     "(1) helps　(2) any　(3) are playing　(4) visited　(5) faster　(6) must"),
    ("选择合适的词填空（每空一词）：\n"
     "   (1) Would you like __________ tea?\n"
     "   (2) This is the __________ book of the three.\n"
     "   (3) She __________ reads English in the morning.\n"
     "   (4) We __________ be late for class.\n"
     "   (5) They __________ to the zoo yesterday.\n"
     "   (6) __________ your brother like playing football?",
     "(1) some　(2) best　(3) always　(4) mustn't　(5) went　(6) Does"),
    ("用下列词的适当形式填空：\n"
     "   (1) Are there __________ (some) tomatoes in the basket?\n"
     "   (2) My sister __________ (study) in No. 3 Middle School.\n"
     "   (3) Look! The boys __________ (run) on the playground.\n"
     "   (4) There is __________ (little) water in the bottle than in the cup.\n"
     "   (5) He is the __________ (tall) of the two brothers.\n"
     "   (6) I __________ (see) Mr Wang in the street yesterday.",
     "(1) any　(2) studies　(3) are running　(4) less　(5) taller　(6) saw"),
]

COMM = [
    ("— How do you usually go to school?\n   — ______", "I usually go to school by bus."),
    ("— What does your father do?\n   — ______", "He is a doctor."),
    ("— What are you doing now?\n   — ______", "I am doing my homework."),
    ("— Where did you go last Sunday?\n   — ______", "I went to the park with my friends."),
    ("— Would you like some tea?\n   — ______", "Yes, please."),
    ("— Must I finish it now?\n   — ______", "No, you needn't. You can do it tomorrow."),
    ("— How often do you exercise?\n   — ______", "Twice a week."),
    ("— Can I help you?\n   — ______", "Yes, I'd like a kilo of apples."),
    ("— Which is bigger, the sun or the moon?\n   — ______", "The sun is bigger."),
    ("— What did you do last night?\n   — ______", "I watched a film with my family."),
    ("— How much is this coat?\n   — ______", "It is ninety yuan."),
    ("— Is there any milk in the fridge?\n   — ______", "Yes, there is some."),
    ("— Who is taller, you or your brother?\n   — ______", "My brother is taller than me."),
    ("— Why do you like English?\n   — ______", "Because it is interesting and useful."),
    ("— Shall we go to the library?\n   — ______", "Good idea. Let's go."),
    ("— What is your favourite subject?\n   — ______", "My favourite subject is English."),
    ("— How was your weekend?\n   — ______", "It was great. I visited my grandparents."),
    ("— Excuse me, where is the post office?\n   — ______", "Go along this street and turn left."),
    ("— You look tired. What's the matter?\n   — ______", "I went to bed late last night."),
    ("— Thank you for your help.\n   — ______", "You're welcome."),
]

READING = [
    ("A Busy Morning",
     "It is seven thirty on Monday morning. The Green family are all busy. Mrs Green is cooking "
     "breakfast in the kitchen. There are eggs, bread and a big pot of milk on the table. Mr Green "
     "is reading the newspaper and waiting for his coffee. Their daughter Amy is looking for her "
     "schoolbag. She usually puts it near the door, but today it is not there.\n"
     "Her little brother Jack is still in bed. He is younger than Amy and he never gets up early. "
     "Mrs Green calls him twice. At last Jack comes out, washing his face with one hand. Amy "
     "finds her bag under the sofa. 'You went to bed late last night,' Mrs Green says with a "
     "smile. 'That is why you cannot find things in the morning.' The two children laugh, and "
     "then they sit down to eat together.",
     [("What is Mrs Green doing in the kitchen?", "She is cooking breakfast."),
      ("What is on the table?", "There are eggs, bread and a big pot of milk."),
      ("What is Amy looking for?", "She is looking for her schoolbag."),
      ("Where does Amy usually put her schoolbag?", "She usually puts it near the door."),
      ("Why is Jack still in bed?", "Because he is younger than Amy and never gets up early."),
      ("Where does Amy find her bag at last?", "She finds it under the sofa.")]),

    ("Last Weekend",
     "Last Saturday our class went to a farm in the countryside. We met at the school gate at "
     "eight and took a bus there. The weather was fine, but the wind was a little cold.\n"
     "A farmer showed us around. There were twenty cows, a lot of chickens and three horses on "
     "the farm. He told us that the cows ate grass and gave milk every day. Some of us helped "
     "feed the chickens. It was harder than it looked, because the chickens ran very fast. At "
     "noon we had lunch under a big tree. The food was simple, but everyone ate a lot. In the "
     "afternoon we picked apples. I picked eight kilos, more than any other student in my group. "
     "We came back at five. I was tired, but I learned a lot that day.",
     [("Where did the class go last Saturday?", "They went to a farm in the countryside."),
      ("How did they get there?", "They took a bus. / By bus."),
      ("How many cows were there on the farm?", "There were twenty cows."),
      ("Why was feeding the chickens hard?", "Because the chickens ran very fast."),
      ("How many kilos of apples did the writer pick?", "Eight kilos."),
      ("How did the writer feel at the end of the day?", "Tired, but he or she learned a lot.")]),

    ("My New Deskmate",
     "My new deskmate is called Nina. She came to our class two weeks ago. She is a little "
     "taller than me, and she has short hair and bright eyes. She speaks softly, but she is never "
     "shy when she answers questions.\n"
     "Nina works harder than anyone else in our class. She always finishes her homework before "
     "dinner and reads English for twenty minutes every evening. She is also good at maths. Last "
     "week I could not work out a difficult problem, and she explained it to me twice. Now we "
     "often study together in the library. At the moment she is sitting beside me and writing a "
     "letter to her old friend. I am glad to have such a helpful deskmate.",
     [("When did Nina come to the class?", "She came two weeks ago."),
      ("What does Nina look like?", "She is a little taller, with short hair and bright eyes."),
      ("What does Nina do every evening?", "She reads English for twenty minutes."),
      ("What did Nina do for the writer last week?", "She explained a difficult maths problem twice."),
      ("Where do they often study together?", "In the library."),
      ("What is Nina doing at the moment?", "She is sitting beside the writer and writing a letter.")]),

    ("The School Trip",
     "Last Friday our school organised a trip to the city museum. We left at eight in the "
     "morning by bus. Our teacher told us to bring a notebook and a bottle of water.\n"
     "The museum was much bigger than I expected. There were three halls. In the first hall we "
     "saw old coins and bowls. A guide explained how people lived hundreds of years ago. In the "
     "second hall there were many paintings. My favourite one showed a small village in winter. "
     "In the third hall we watched a short film about the history of our city. Before we left, "
     "each of us wrote down one thing we had learned. I wrote that a city changes slowly, but it "
     "never stops. We got back to school at four. It was the best trip of this term.",
     [("How did the students go to the museum?", "By bus."),
      ("What did the teacher tell them to bring?", "A notebook and a bottle of water."),
      ("How many halls were there in the museum?", "There were three halls."),
      ("What did they see in the first hall?", "Old coins and bowls."),
      ("What did the writer write down before leaving?", "That a city changes slowly, but it never stops."),
      ("What did the writer think of the trip?", "It was the best trip of the term.")]),

    ("A Letter from Grandma",
     "Dear Amy,\n"
     "How are you? I am writing to tell you about my new garden. Your grandpa and I moved to a "
     "small house in April, and now the garden is full of green things.\n"
     "Every morning I water the flowers before breakfast. Grandpa grows tomatoes and beans. Last "
     "week we picked our first tomatoes, and they tasted much sweeter than the ones from the "
     "shop. There are two old apple trees, too. At the moment the birds are singing in them. I "
     "am sitting by the window and watching them while I write this letter.\n"
     "We miss you very much. Please come and stay with us in the summer holiday. The garden will "
     "be even more beautiful then.\n"
     "Love,\n"
     "Grandma",
     [("When did Grandma and Grandpa move to the small house?", "In April."),
      ("What does Grandma do every morning?", "She waters the flowers before breakfast."),
      ("What does Grandpa grow?", "Tomatoes and beans."),
      ("How did the first tomatoes taste?", "Much sweeter than the ones from the shop."),
      ("What is Grandma doing while writing the letter?", "She is sitting by the window and watching the birds."),
      ("What does Grandma ask Amy to do?", "To come and stay with them in the summer holiday.")]),

    ("Our English Corner",
     "Every Wednesday afternoon our school holds an English Corner in the reading room. It "
     "starts at four and ends at five. Students from different classes come to talk in English.\n"
     "At the moment about thirty students are sitting in small groups. Two girls are discussing "
     "their favourite books, and a boy from Class Four is telling a funny story. Miss Zhang, our "
     "English teacher, is walking between the groups and helping with new words. She never "
     "corrects every mistake. 'Speak more, and you will speak better,' she often says.\n"
     "I was afraid to open my mouth at first, but last month I talked with a student from Grade "
     "Eight for ten minutes. Now I go there every week. It is more useful than reading alone, "
     "because I can learn real English from real people.",
     [("When does the English Corner start?", "It starts at four on Wednesday afternoon."),
      ("How many students are there at the moment?", "About thirty students."),
      ("What is the boy from Class Four doing?", "He is telling a funny story."),
      ("What is Miss Zhang doing?", "She is walking between the groups and helping with new words."),
      ("What did the writer do last month?", "Talked with a Grade Eight student for ten minutes."),
      ("Why does the writer think the English Corner is useful?", "Because real English can be learned from real people.")]),

    ("The Lost Bag",
     "Yesterday afternoon I could not find my schoolbag. I put it on a chair in the library at "
     "three o'clock, and when I came back at four it was gone. I looked under the table and "
     "behind the bookshelf, but there was nothing there.\n"
     "I asked the librarian, Miss Wu, for help. She was very calm. 'Someone may have moved it,' "
     "she said. We walked along the shelves together. At last we found my bag on a desk near the "
     "window. A cleaner had put it there while she cleaned the floor. My books and my pencil box "
     "were all inside, and nothing was missing.\n"
     "I thanked Miss Wu and the cleaner. On my way home I decided to be more careful with my "
     "things. It was a small accident, but it taught me a useful lesson.",
     [("Where did the writer put the bag at three o'clock?", "On a chair in the library."),
      ("When did the writer come back?", "At four o'clock."),
      ("Who did the writer ask for help?", "Miss Wu, the librarian."),
      ("Where was the bag found at last?", "On a desk near the window."),
      ("Who had moved the bag?", "A cleaner had moved it while cleaning the floor."),
      ("What did the writer decide on the way home?", "To be more careful with his or her things.")]),

    ("A Rainy Saturday",
     "It rained all day last Saturday, so my family stayed at home. At nine in the morning my "
     "sister and I were playing chess by the window. My mother was cooking in the kitchen, and "
     "my father was fixing a broken chair.\n"
     "After lunch the rain became heavier. We could not go out, so my father suggested a game. "
     "Each of us had to tell a story in English. My sister told a short one about a cat, and "
     "everyone laughed. My story was longer, but I made three grammar mistakes. My mother "
     "corrected them kindly. In the evening the rain stopped. We opened the windows and the air "
     "smelled fresh and clean. It was not an exciting day, but it was warmer than usual, because "
     "we spent every hour together.",
     [("Why did the family stay at home?", "Because it rained all day."),
      ("What were the children doing at nine in the morning?", "They were playing chess by the window."),
      ("What was the father doing before lunch?", "He was fixing a broken chair."),
      ("What game did the father suggest after lunch?", "Each of them told a story in English."),
      ("How many grammar mistakes did the writer make?", "Three."),
      ("Why was the day warmer than usual?", "Because the family spent every hour together.")]),

    ("My Cousin's Hobby",
     "My cousin Leo is fourteen years old. He collects model planes. He started this hobby when "
     "he was nine, and now he has more than forty of them.\n"
     "Every Saturday morning he goes to a small shop near his home and looks for new models. He "
     "never buys the most expensive one. 'The cheapest box can be the most interesting,' he "
     "says. Then he spends two hours putting the pieces together at his desk. He works more "
     "carefully than I do, so his planes always look perfect. Last month he made a big silver "
     "one and gave it to me for my birthday.\n"
     "At the moment he is building a white plane with blue wings. I am watching him. He is "
     "slower than usual today, because the pieces are very small. I think his hobby teaches him "
     "patience, and that is more valuable than the planes themselves.",
     [("How old is Leo?", "He is fourteen years old."),
      ("When did Leo start collecting model planes?", "When he was nine."),
      ("How many model planes does he have now?", "More than forty."),
      ("Where does he go every Saturday morning?", "To a small shop near his home."),
      ("What did Leo give the writer last month?", "A big silver model plane."),
      ("Why is Leo slower than usual today?", "Because the pieces are very small.")]),

    ("The Class Meeting",
     "We had a class meeting last Monday afternoon. Our teacher asked us to talk about how to "
     "make our class better. At first nobody spoke. Then Linda stood up.\n"
     "She said our classroom was not tidy enough, because some students left paper on the floor. "
     "She suggested a cleaning plan: two students would clean the room after school every day. "
     "Everyone agreed. Then Tom said we should start a small class library. He brought ten books "
     "the next morning, and other students brought more. By Friday we had over sixty books.\n"
     "Our teacher wrote all the ideas on the blackboard. At the end of the meeting she said, 'A "
     "good class is not made by one person.' I think she was right. Now our room is cleaner, and "
     "we read more than before. The meeting was short, but it changed a lot.",
     [("When did the class meeting take place?", "Last Monday afternoon."),
      ("What was the meeting about?", "How to make the class better."),
      ("What problem did Linda point out?", "The classroom was not tidy enough; some students left paper on the floor."),
      ("What did Tom suggest?", "Starting a small class library."),
      ("How many books did they have by Friday?", "Over sixty books."),
      ("What did the teacher say at the end?", "That a good class is not made by one person.")]),

    ("Two Cities",
     "Shanghai and Hangzhou are both beautiful cities in the east of China, but they are quite "
     "different. Shanghai is much bigger and busier. There are more tall buildings and more "
     "people in its streets. The underground there runs faster than the buses, so many people "
     "take it to work.\n"
     "Hangzhou is smaller and quieter. It is famous for the West Lake. Last autumn I visited it "
     "with my parents. We walked around the lake for two hours. The air was cleaner than in the "
     "city centre, and the hills looked soft in the light rain. The food in Hangzhou is a little "
     "sweeter than Shanghai food, but I enjoyed both.\n"
     "Which city do I like better? It is hard to say. Shanghai is more exciting, but Hangzhou is "
     "more relaxing. I am happy that I can visit both of them.",
     [("Which city is bigger and busier?", "Shanghai."),
      ("Why do many people in Shanghai take the underground?", "Because it runs faster than the buses."),
      ("What is Hangzhou famous for?", "The West Lake."),
      ("When did the writer visit Hangzhou?", "Last autumn."),
      ("How is Hangzhou food different from Shanghai food?", "It is a little sweeter."),
      ("What does the writer think of the two cities?", "Shanghai is more exciting, but Hangzhou is more relaxing.")]),

    ("The New Library",
     "Our school opened a new library last month. Before that, we only had a small reading room "
     "with two bookshelves. Now there is a bright hall with more than five thousand books, and it "
     "is much quieter than the old room.\n"
     "On the first day I went there with my classmate Peter. A librarian showed us how to find a "
     "book by its number. I borrowed a science book, and Peter chose a storybook. We sat by the "
     "big window and read for an hour. At the moment the library is holding a reading week. "
     "Students are making posters about their favourite books, and mine is on the wall near the "
     "door.\n"
     "Miss Wu, the librarian, says more students come here now than last term. I think that is "
     "because the new hall is warm, quiet and full of light.",
     [("When did the new library open?", "Last month."),
      ("What was there before the new library?", "A small reading room with two bookshelves."),
      ("How many books are there in the new hall?", "More than five thousand."),
      ("What did the librarian show the students?", "How to find a book by its number."),
      ("What is the library holding at the moment?", "A reading week."),
      ("Why do more students come now?", "Because the new hall is warm, quiet and full of light.")]),

    ("A Phone Call",
     "'Hello, is that Lucy?' I asked on the phone last night. 'Yes, speaking,' she answered.\n"
     "I called to ask about the homework, but Lucy was busy. 'I am helping my mother in the "
     "kitchen,' she said. 'We are making dumplings for my grandpa's birthday.' I could hear "
     "water running and someone laughing in the background. 'Can you call me again in half an "
     "hour?' she asked.\n"
     "I said yes and put the phone down. Then I did my maths exercises. At eight I called again. "
     "This time Lucy was free. She explained the two problems slowly, more clearly than our "
     "teacher did in class. I wrote everything down and thanked her. The call was short, but it "
     "helped me more than an hour of reading the book alone.",
     [("Why did the writer call Lucy?", "To ask about the homework."),
      ("What was Lucy doing during the first call?", "She was helping her mother make dumplings."),
      ("Whose birthday were they preparing for?", "Lucy's grandpa's birthday."),
      ("What did the writer do between the two calls?", "His or her maths exercises."),
      ("How did Lucy explain the problems?", "Slowly and more clearly than the teacher did in class."),
      ("How long was the second call?", "Short. / The passage does not give the exact time.")]),

    ("Grandpa's Garden",
     "My grandpa is seventy, but he works in his garden every morning. He gets up at five and "
     "carries water from a small well. His garden is not large, yet it is the greenest place in "
     "our village.\n"
     "He grows cabbages, beans and sunflowers. He knows every plant by name. Last spring I "
     "helped him plant three young apple trees. They were shorter than me then; now they are "
     "taller than my father. Grandpa never uses chemicals. 'The soil is healthier this way,' he "
     "says, and the vegetables do taste better.\n"
     "At the moment he is sitting on an old chair under the biggest tree, watching the bees. I "
     "am sitting beside him. He speaks little, but I learn more from him in one quiet morning "
     "than from a whole book.",
     [("How old is Grandpa?", "He is seventy."),
      ("What time does he get up?", "At five."),
      ("What does he grow in the garden?", "Cabbages, beans and sunflowers."),
      ("What did the writer help plant last spring?", "Three young apple trees."),
      ("Why does Grandpa never use chemicals?", "Because he believes the soil is healthier that way."),
      ("What is Grandpa doing at the moment?", "He is sitting under the biggest tree, watching the bees.")]),

    ("The Sports Meeting",
     "Our school sports meeting was held last Thursday. It was sunny but windy. All the students "
     "in Grade Seven took part in it, and our class won three prizes.\n"
     "The first event was the 100-metre race. Jack from Class Two ran the fastest and won a gold "
     "medal. I was in the long jump. My best jump was 3.4 metres, better than last year, but I "
     "only got third place. I was a little disappointed at first. Then my teacher said, 'You "
     "jumped further than before, and that is what matters.'\n"
     "In the afternoon our relay team came second. We were all out of breath, but we cheered for "
     "each other. At the end of the day everyone was tired. Still, I think it was the happiest "
     "day of this term, because we worked as a team.",
     [("When was the sports meeting held?", "Last Thursday."),
      ("What was the weather like?", "Sunny but windy."),
      ("Who won the 100-metre race?", "Jack from Class Two."),
      ("What place did the writer get in the long jump?", "Third place."),
      ("What did the teacher say to the writer?", "That he or she jumped further than before and that is what matters."),
      ("Why was it the happiest day of the term?", "Because they worked as a team.")]),

    ("My Favourite Season",
     "Of the four seasons, I like autumn best. Summer is hotter, but it is often too wet and "
     "noisy. Winter is colder than autumn, and the days are shorter. Spring is lovely, yet the "
     "wind in my city is stronger than in any other season. Autumn is the most comfortable.\n"
     "In autumn the sky is higher and the air is drier. The leaves turn yellow and red, and the "
     "parks are quieter than in summer. Last October my family climbed a small hill near our "
     "town. We took a lot of photos and had a picnic at the top. The view was more beautiful than "
     "I had imagined.\n"
     "Now it is late September. The mornings are already cooler. I am waiting for the first "
     "yellow leaf, because it means my favourite season is coming again.",
     [("Which season does the writer like best?", "Autumn."),
      ("Why doesn't the writer like summer as much?", "Because it is often too wet and noisy."),
      ("How are winter days compared with autumn days?", "They are shorter."),
      ("What did the family do last October?", "They climbed a hill, took photos and had a picnic."),
      ("How was the view from the top?", "More beautiful than the writer had imagined."),
      ("What is the writer waiting for now?", "The first yellow leaf.")]),

    ("A Surprise for Mum",
     "Last Sunday was my mother's birthday. My sister and I decided to give her a surprise. We "
     "got up at six, earlier than usual, and went into the kitchen quietly.\n"
     "I washed the fruit and my sister beat two eggs. We wanted to make noodles, but we made the "
     "kitchen very messy. There was flour on the table and even on the floor. When Mum came in at "
     "seven, the noodles were ready. They did not look as nice as hers, and they were a little "
     "too salty. But she ate a whole bowl and said they were the best noodles she had ever had.\n"
     "After breakfast we cleaned the kitchen together. It took us nearly an hour, longer than "
     "the cooking. I was tired, but I was happier than on any other Sunday. Giving is much nicer "
     "than receiving.",
     [("What was the special day last Sunday?", "The writer's mother's birthday."),
      ("What time did the children get up?", "At six."),
      ("What did they want to make?", "Noodles."),
      ("How did the noodles taste?", "A little too salty."),
      ("How long did it take to clean the kitchen?", "Nearly an hour."),
      ("What did the writer learn?", "That giving is much nicer than receiving.")]),

    ("The Busy Kitchen",
     "It is six o'clock in the evening and our kitchen is the busiest room in the house. My "
     "mother is cutting vegetables. My father is washing rice by the sink. My grandma is sitting "
     "at the small table and telling me about her day.\n"
     "I am setting the table, but I am slower than usual because I am also thinking about my "
     "English homework. There are four bowls, four pairs of chopsticks and a big plate of fish on "
     "the table. Something smells wonderful. 'Dinner will be ready in ten minutes,' Mum says.\n"
     "Last night we ate out in a restaurant. The food was more expensive, but it was not warmer "
     "than this kitchen. At the moment my little brother is running in from the living room. He "
     "is always the hungriest of us all.",
     [("What is the mother doing?", "She is cutting vegetables."),
      ("What is the father doing?", "He is washing rice by the sink."),
      ("What is the writer doing?", "Setting the table."),
      ("What is on the table?", "Four bowls, four pairs of chopsticks and a big plate of fish."),
      ("Where did the family eat last night?", "In a restaurant."),
      ("Who is always the hungriest?", "The writer's little brother.")]),

    ("Learning to Cook",
     "I could not cook anything before this summer. In July my aunt invited me to stay with her "
     "for two weeks and taught me how to make a simple dish: tomato and egg.\n"
     "The first time I cut the tomatoes into big pieces and put in too much salt. The dish was "
     "much saltier than hers. My aunt did not complain. She just showed me again, more slowly "
     "than before. On the fourth day I cooked it by myself. The colour was brighter and the "
     "taste was better. When my parents came to pick me up, I made the dish for them. My father "
     "ate two bowls, more than anyone else.\n"
     "Now I cook it once a week at home. I am still learning, but I am more patient than I was. "
     "Cooking teaches you to do a small thing well, again and again.",
     [("What could the writer not do before this summer?", "Cook anything."),
      ("Who taught the writer to cook?", "The writer's aunt."),
      ("What was wrong with the first dish?", "It was much saltier than the aunt's and the tomatoes were in big pieces."),
      ("When did the writer cook the dish alone?", "On the fourth day."),
      ("How much did the father eat?", "Two bowls, more than anyone else."),
      ("What does the writer think cooking teaches?", "To do a small thing well, again and again.")]),

    ("A Note to My Friend",
     "Hi Sandy,\n"
     "I am writing to ask you about the reading club. I heard that you joined it last month. "
     "I went to the library yesterday, but the door was closed, so I could not ask Miss Wu.\n"
     "Could you tell me three things? First, when does the club meet? Second, how many books "
     "should we read each month? Third, is the meeting room bigger than our classroom? I ask "
     "because more students are joining now, and our classroom is already the smallest one in "
     "Grade Seven.\n"
     "By the way, I am reading a storybook about a brave girl these days. It is much more "
     "interesting than the last one I borrowed. If you are free this weekend, we can talk about "
     "it in the park. Please write back soon.\n"
     "Yours,\n"
     "Kitty",
     [("Why is Kitty writing to Sandy?", "To ask about the reading club."),
      ("What happened when Kitty went to the library yesterday?", "The door was closed."),
      ("How many questions does Kitty ask?", "Three."),
      ("Why does Kitty ask about the size of the meeting room?", "Because more students are joining and their classroom is the smallest in Grade Seven."),
      ("What is Kitty reading these days?", "A storybook about a brave girl."),
      ("What does Kitty suggest for the weekend?", "Talking about the book in the park.")]),
]

RUBRIC = [
    ("内容切合题意，要点齐全，格式规范", 15),
    ("语言基本正确，句子通顺", 12),
    ("能恰当运用不同时态与较复杂句式", 8),
    ("不少于 70 词，词数在 80 词左右", 5),
]

WRITING = [
    ("Please write an email of about 80 words to your pen pal Peter about your school life. "
     "You should say what time your school starts, what subjects you like, what you did last "
     "weekend and what you are doing these days.",
     RUBRIC,
     "Dear Peter,\n"
     "I am glad to hear from you. My school starts at eight every morning. We have six lessons a "
     "day, and I like English and PE best because they are the most interesting. Last weekend I "
     "visited my grandparents and helped them clean the garden. These days I am reading a book "
     "about animals, and I am also practising for the school sports meeting. My school life is "
     "busy but happy. Please tell me about yours.\n"
     "Yours,\n"
     "Li Hua"),
    ("Please write a diary entry of about 80 words about a day you helped at home. "
     "You should say what you did, who you did it with, what was happening at that moment "
     "and how you felt.",
     RUBRIC,
     "Saturday, 18 October\n"
     "Today I helped my parents clean the house. In the morning I washed all the bowls while Mum "
     "was cooking lunch. Dad was fixing the broken chair, and my sister was cleaning the windows. "
     "The kitchen was much brighter when we finished. At that moment I was tired but very happy. "
     "Last Sunday I did nothing at home, so today was better and more useful. I think helping at "
     "home is the best way to show love to my family. I will do it again next weekend."),
    ("Please write a short notice of about 80 words for the school English Club. "
     "You should say when and where the activity will be, what students will do there, "
     "what they must bring and why the activity is useful.",
     RUBRIC,
     "Notice\n"
     "The English Club will hold a reading activity in the school library next Wednesday "
     "afternoon. It will start at four and end at five. We will read short English stories in "
     "groups and talk about our favourite ones. Miss Zhang will help us with new words. Please "
     "bring a notebook and a pen, and you must keep quiet in the library. The activity is more "
     "useful than reading alone, because you can learn from other students. Everyone in Grade "
     "Seven is welcome.\n"
     "English Club"),
    ("Please write a letter of about 80 words to your friend Amy about a trip you took last "
     "month. You should say where you went, how you got there, what you saw and did, "
     "and compare it with your last trip.",
     RUBRIC,
     "Dear Amy,\n"
     "How are you? Last month our class went to the city museum by bus. It was much bigger than "
     "the old reading room we visited last term. We saw old coins and bowls in the first hall, "
     "and we watched a short film about our city in the third one. Before we left, each of us "
     "wrote down one thing we had learned. I think this trip was more interesting than the last "
     "one, because I learned a lot. Please write and tell me about your trip.\n"
     "Yours,\n"
     "Kitty"),
]
