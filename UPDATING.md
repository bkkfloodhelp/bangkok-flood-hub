# วิธีอัปเดตข้อมูล · How to update the information

คู่มือนี้สำหรับอาสาสมัครที่ไม่ได้เขียนโปรแกรม แก้ไขได้บน github.com โดยตรง ไม่ต้องติดตั้งอะไร
This guide is for volunteers who don't write code. Everything is done on github.com and there is nothing to install.

**You only ever edit one file: `data/flood.json`.**
**ไฟล์เดียวที่ต้องแก้คือ `data/flood.json`**

---

## ก่อนเริ่ม · Before you start

- ต้องมีบัญชี GitHub และได้รับสิทธิ์แก้ไขจากผู้ดูแล
  You need a GitHub account and edit access from the maintainer.
- **ใส่เฉพาะข้อมูลที่มีแหล่งที่มา** (ข่าว ประกาศ กทม. หรือโทรยืนยันเอง) และระบุไว้ในช่อง `source`
  **Only add information you have a source for** (news, a BMA announcement, or your own phone call), and write that source in the `source` field.
- **ห้ามแก้เบอร์โทรหรือชื่อสถานที่ถ้ายังไม่ได้ยืนยัน** ถ้าสงสัยว่าผิด ให้แจ้งผู้ดูแล
  **Don't change a phone number or a place name unless you have confirmed it.** If you think something is wrong, tell the maintainer.
- ห้ามใส่ข้อมูลส่วนตัวของผู้ประสบภัย (ชื่อ เบอร์โทรส่วนตัว ที่อยู่บ้าน)
  Never add personal details of flood victims (names, private phone numbers, home addresses).

---

## ขั้นตอน · Steps

### 1. เปิดไฟล์ · Open the file
ไปที่หน้า repository บน github.com → คลิกโฟลเดอร์ `data` → คลิก `flood.json`
Go to the repository on github.com → click the `data` folder → click `flood.json`.

### 2. กดแก้ไข · Click edit
กดไอคอน **ดินสอ ✏️** มุมขวาบนของไฟล์
Click the **pencil icon ✏️** at the top right of the file.

### 3. แก้ข้อมูล · Make your change
ดูตัวอย่างด้านล่าง แก้เฉพาะข้อความในเครื่องหมาย `"..."` ระวังอย่าลบเครื่องหมาย `"` `,` `{ }` `[ ]`
See the examples below. Only change the text inside `"..."`, and be careful not to delete any `"`, `,`, `{ }` or `[ ]`.

**ทุกครั้งที่แก้รายการไหน ให้แก้เวลา `updated` ของรายการนั้น และแก้ `lastUpdated` ที่บรรทัดบนสุดด้วย**
**Whenever you change an item, also update that item's `updated` time and the `lastUpdated` time at the top of the file.**

### 4. บันทึก · Save (commit)
กดปุ่มสีเขียว **Commit changes...** → เขียนสั้น ๆ ว่าแก้อะไร เช่น `เพิ่มศูนย์พักพิงวัดxxx` → เลือก **Commit directly to the main branch** → กด **Commit changes**
Click the green **Commit changes...** button → write a short note of what you changed, e.g. `Add shelter at Wat xxx` → choose **Commit directly to the main branch** → click **Commit changes**.

### 5. ตรวจผล · Check the result (สำคัญ · important)
คลิกแท็บ **Actions** ด้านบน ดูรายการล่าสุด (รอประมาณ 1–2 นาที)
Click the **Actions** tab at the top and look at the newest run. It takes about 1–2 minutes.

- ✅ **เครื่องหมายถูกสีเขียว** = ข้อมูลถูกต้องและขึ้นหน้าเว็บแล้ว
  **Green tick** = the data is valid and the site is updated.
- ❌ **กากบาทสีแดง** = มีข้อผิดพลาด **หน้าเว็บยังเป็นข้อมูลเดิม (ไม่เสียหาย)** ให้คลิกเข้าไปดู แล้วไปข้อ 6
  **Red cross** = there is a mistake. **The live site is unchanged and still safe.** Click the run and go to step 6.

> หมายเหตุ: เบราว์เซอร์และ GitHub อาจเก็บหน้าเดิมไว้ประมาณ 10 นาที ถ้ายังไม่เห็นข้อมูลใหม่ให้รอสักครู่แล้วรีเฟรช
> Note: browsers and GitHub may keep the old page for about 10 minutes. If you don't see your change yet, wait and refresh.

### 6. ถ้ามีข้อผิดพลาด · If there is an error
คลิกรายการสีแดง → คลิก **Check flood.json / ตรวจสอบข้อมูล** → อ่านข้อความ ❌ ERROR ซึ่งบอกทั้งตำแหน่งและวิธีแก้เป็นภาษาไทย
Click the red run → click **Check flood.json / ตรวจสอบข้อมูล** → read the ❌ ERROR lines. Each one says where the problem is and how to fix it, in English and Thai.

ตัวอย่าง · Example:
```
❌ ERROR shelters[3].tel: "08-978-3595" is not a valid Thai phone number. ...
    ข้อผิดพลาด: "08-978-3595" ไม่ใช่รูปแบบเบอร์โทรที่ถูกต้อง ...
```
`shelters[3]` หมายถึงศูนย์พักพิง **ลำดับที่ 4** (เริ่มนับจาก 0) · `shelters[3]` means the **4th** shelter (counting starts at 0).

กลับไปแก้ `flood.json` อีกครั้ง (ข้อ 1–4) จนได้เครื่องหมายสีเขียว ถ้าแก้ไม่ได้ ติดต่อผู้ดูแล
Edit `flood.json` again (steps 1–4) until you get a green tick. If you're stuck, contact the maintainer.

---

## วิธีเขียนเวลา · How to write a time

รูปแบบ · Format: `ปี-เดือน-วันTชั่วโมง:นาที:00+07:00`

```
"2026-09-27T09:45:00+07:00"
```
= 27 ก.ย. 2026 เวลา 09:45 น. (เวลาไทย) · 27 Sep 2026, 09:45 Bangkok time

- ใช้ปี **ค.ศ.** (2026) **ไม่ใช่ พ.ศ.** (2569) · Use the **AD** year (2026), **not** the Buddhist year (2569).
- ใช้เวลา 24 ชั่วโมง (บ่ายสองโมง = `14:00`) · Use 24-hour time (2 pm = `14:00`).
- ต้องมี `T` ตรงกลาง และ `+07:00` ท้ายเสมอ · Always keep the `T` in the middle and `+07:00` at the end.
- ใส่เวลาที่ **แหล่งข่าวประกาศ** หรือเวลาที่ **คุณโทรยืนยัน** ไม่ใช่เวลาที่พิมพ์
  Use the time the **source published it** or the time **you confirmed it by phone**, not the time you are typing.

---

## ตัวอย่าง · Examples

### แก้ประกาศสถานการณ์ · Change the status message
```json
"status": {
  "updated": "2026-09-27T09:45:00+07:00",
  "source": "Khaosod English",
  "title": { "th": "หัวข้อภาษาไทย", "en": "English headline" },
  "body":  { "th": "รายละเอียดภาษาไทย", "en": "English details" }
},
```

### เพิ่มศูนย์พักพิง · Add a shelter
คัดลอกบล็อกของศูนย์ที่มีอยู่ วางต่อท้าย แล้วแก้ข้อมูล **อย่าลืม `,` คั่นระหว่างบล็อก**
Copy an existing shelter block, paste it after the last one, and edit it. **Don't forget the `,` between blocks.**
```json
    {
      "name": { "th": "ชื่อภาษาไทย", "en": "English name" },
      "district": { "th": "บางเขน", "en": "Bang Khen" },
      "tel": "081-234-5678",
      "updated": "2026-09-27T09:45:00+07:00",
      "source": "โทรยืนยันกับศูนย์ / Phoned the shelter",
      "sourceUrl": "https://..."
    }
```
- ไม่รู้เขต → `"district": null` · District unknown → `"district": null`
- ไม่มีเบอร์ → `"tel": null` · No phone number → `"tel": null`
- `null` ไม่มีเครื่องหมายคำพูด · `null` has **no** quotes.
- `sourceUrl` ใส่หรือไม่ใส่ก็ได้ ถ้าไม่ใส่ให้ลบทั้งบรรทัด และลบ `,` ท้ายบรรทัดก่อนหน้า
  `sourceUrl` is optional. If you remove it, delete the whole line and the `,` at the end of the line before it.
- **District names must be written exactly the same way every time** (e.g. always `"Bang Khen"`), or the district filter will list the district twice.

### ปิดศูนย์พักพิง · Remove a shelter
ลบทั้งบล็อก `{ ... }` ของศูนย์นั้น แล้วตรวจว่าไม่มี `,` เกินหลังบล็อกสุดท้าย
Delete that shelter's whole `{ ... }` block, then check there is no extra `,` after the last block.

### แก้ถนน · Update a road
**เขียนชื่อให้ครบ ตรงตามที่ต้องการให้แสดงบนหน้าเว็บ** หน้าเว็บจะไม่เติม "ถ." หรือ "Rd" ให้
**Write the name in full, exactly as it should appear on the page.** The page does not add "ถ." or "Rd".

ถนนทั่วไป · A normal road:
```json
    { "name": { "th": "ถ.สุขุมวิท", "en": "Sukhumvit Rd" }, "type": "avoid", "updated": "2026-09-27T09:45:00+07:00", "source": "BMA via Khaosod English" },
```
จุดที่ไม่ใช่ชื่อถนน เช่น แยก หรือ ซอย ไม่ต้องมี "ถ." หรือ "Rd" · A place that isn't a road name (an intersection, a soi) has no "ถ." or "Rd":
```json
    { "name": { "th": "แยกพงษ์เพชร", "en": "Phong Phet intersection" }, "type": "avoid", "updated": "2026-09-27T09:45:00+07:00", "source": "BMA via Khaosod English" },
```
- `"type"`: `"avoid"` = เลี่ยง (red text) · `"slow"` = ขับช้า (yellow) · `"no-small-cars"` = รถเล็กห้ามผ่าน / No small cars (solid red)
- ระวังอย่าใส่ซ้ำ เช่น "ถ.ถ.สุขุมวิท" หรือ "Sukhumvit Rd Rd" ระบบตรวจสอบจะเตือน (⚠️) แต่ยังขึ้นหน้าเว็บ จึงควรแก้ทันที
  Don't write it twice ("ถ.ถ.สุขุมวิท", "Sukhumvit Rd Rd"). The check shows a ⚠️ warning but the page still updates, so fix it straight away.
- **ถ้ายืนยันว่าถนนยังท่วมอยู่ ให้แก้เวลา `updated` เป็นเวลาที่ยืนยัน** ถ้าข้อมูลถนนเก่ากว่า 6 ชั่วโมง หน้าเว็บจะขึ้นคำเตือนสีแดงให้ผู้ใช้โทรเช็ก 1555
  **If you confirm a road is still flooded, set its `updated` to the time you confirmed it.** When road information is over 6 hours old, the page shows a red warning telling people to check with 1555.

### หมายเหตุเหนือรายการถนน · Note above the road list
กล่องสีเหลืองเหนือรายการถนน ใช้แจ้งข้อควรระวัง เช่น รายการยังไม่ครบ
The yellow box above the road list, for caveats such as "this list is incomplete".
```json
  "roadsNote": {
    "updated": "2026-09-26T13:00:00+07:00",
    "source": "Khaosod English",
    "text": {
      "th": "ข้อความภาษาไทย",
      "en": "English text"
    }
  },
```
ไม่ต้องการแล้ว: ลบทั้งบล็อก `"roadsNote": { ... },` ออก กล่องจะหายไปเอง
No longer needed: delete the whole `"roadsNote": { ... },` block and the box disappears.

### ปุ่มเช็กถนนน้ำท่วมล่าสุด · "Check live road flooding" button
ปุ่มสีน้ำเงินเหนือรายการถนน จะแสดงเมื่อใส่ `roadsLiveUrl` เท่านั้น ลิงก์สำรอง (`roadsLiveUrlAlt`) ใส่หรือไม่ก็ได้
The blue button above the road list only appears when `roadsLiveUrl` is set. The backup link (`roadsLiveUrlAlt`) is optional.
```json
  "roadsLiveUrl": "https://...",
  "roadsLiveUrlAlt": "https://...",
```
ใส่ไว้ใต้ `"roadsNote": { ... },` · Put these after the `"roadsNote": { ... },` block. ลิงก์ขึ้นต้นด้วย `https://` หรือ `http://` · Links start with `https://` or `http://`.

### เครื่องมือตรวจสอบ · "Check for yourself" tools
เว็บไซต์หรือแอปที่ผู้ใช้ตรวจสอบสถานการณ์เองได้ ส่วนนี้จะแสดงเมื่อมีอย่างน้อย 1 รายการ **กดลิงก์ตรวจสอบเองก่อนใส่ทุกครั้ง**
Websites or apps people can use to check the situation themselves. The section only appears once there is at least one entry. **Open the link yourself before adding it.**
```json
  "tools": [
    {
      "name": { "th": "ชื่อภาษาไทย", "en": "English name" },
      "description": { "th": "ใช้ทำอะไร", "en": "What it's for" },
      "url": "https://...",
      "official": true,
      "note": { "th": "ล่มบ่อย กดรีเฟรช", "en": "Often down, try refreshing" },
      "updated": "2026-09-27T09:45:00+07:00",
      "source": "ตรวจลิงก์แล้ว / Link checked"
    }
  ],
```
- `"official"`: `true` = ของหน่วยงานรัฐ (ป้าย "ทางการ") · `false` = ไม่ใช่ (ป้าย "ไม่เป็นทางการ") · `true` = run by a government body ("Official" label) · `false` = not ("Unofficial" label). ไม่มีเครื่องหมายคำพูด · No quotes.
- `"note"` ใส่หรือไม่ก็ได้ · is optional. `"description"` ต้องมีเสมอ · is always required.
- `"updated"` = เวลาที่คุณตรวจว่าลิงก์ยังใช้ได้ · the time you checked the link still works.

### วงเงินช่วยเหลือ (หน้าบันทึกความเสียหาย) · Assistance amounts (damage page)
ตารางวงเงินช่วยเหลือในหน้า `damage.html` มาจาก `"assistance"` แก้เฉพาะเมื่อมีประกาศใหม่จากหน่วยงานรัฐ และระบุแหล่งที่มาทุกครั้ง
The assistance table on `damage.html` comes from `"assistance"`. Only change it when a government body announces new rules, and always give the source.
```json
  "assistance": {
    "updated": "2026-09-26",
    "source": { "th": "กรมประชาสัมพันธ์ ผ่านฐานเศรษฐกิจ", "en": "Government Public Relations Department, via Thansettakij" },
    "links": [ "https://..." ],
    "items": [
      { "label": { "th": "ค่าวัสดุซ่อมแซมที่พักอาศัย ตามความเสียหายจริง", "en": "Home repair materials, based on actual damage" }, "max": { "th": "49,500 บาท ต่อหลัง", "en": "49,500 baht per house" } }
    ]
  },
```
- `"updated"` ใส่แค่วันที่ได้ (`"2026-09-26"`) ถ้าแหล่งข่าวไม่ระบุเวลา · can be just a date if the source gives no time.
- `"max"` เขียนแยกภาษาไทยและอังกฤษ ตัวเลขต้องตรงกันทั้งสองภาษา · Write Thai and English separately; the numbers must match in both.
- **ใส่ตัวเลขตามประกาศเท่านั้น ห้ามประมาณ** · **Only enter amounts exactly as announced. Never estimate.**

### เพิ่มแหล่งข้อมูล · Add a source
```json
    { "title": "BMA Facebook (roads 27 Sep)", "url": "https://..." }
```

---

## ข้อผิดพลาดที่พบบ่อย · Common mistakes

| ปัญหา · Problem | วิธีแก้ · Fix |
|---|---|
| ลืม `,` ระหว่างบล็อกหรือบรรทัด · Missing `,` between blocks or lines | ใส่ `,` ท้ายบรรทัดก่อนหน้า · Add `,` at the end of the line above |
| มี `,` เกินหลังรายการสุดท้าย · Extra `,` after the last item | ลบ `,` ตัวสุดท้ายก่อน `]` หรือ `}` · Delete the last `,` before `]` or `}` |
| เครื่องหมายคำพูดโค้ง `“ ”` (คัดลอกจาก LINE/Word) · Curly quotes `“ ”` copied from LINE/Word | เปลี่ยนเป็น `"` ตรง · Replace with straight `"` |
| ใช้ปี พ.ศ. `2569` · Buddhist year `2569` | ใช้ `2026` · Use `2026` |
| เบอร์มีช่องว่าง `081 234 5678` · Spaces in a phone number | ใช้ขีด `081-234-5678` · Use dashes |
| ลืมแก้ `updated` · Forgot to change `updated` | หน้าเว็บจะบอกว่าข้อมูลเก่า แก้เวลาให้ตรง · The page will show the item as old; set the right time |
| `"urgent": "true"` | ไม่ต้องมีเครื่องหมายคำพูด `"urgent": true` · No quotes |

---

## ถ้าหน้าเว็บผิด · If the live page shows something wrong

ถ้าข้อมูลที่ขึ้นหน้าเว็บผิด (แต่ Actions เป็นสีเขียว) ให้แก้ `flood.json` ใหม่ให้ถูกต้องแล้ว commit ได้ทันที
If the live page shows wrong information (but Actions was green), simply edit `flood.json` again with the correct information and commit.

ถ้าต้องการย้อนกลับเป็นเวอร์ชันก่อน: ที่หน้า `flood.json` กด **History** → เลือกเวอร์ชันที่ถูก → กด **⋯ → View file** → กด **Raw** → คัดลอกทั้งหมด → กลับไปแก้ไข `flood.json` แล้ววางแทนทั้งไฟล์ → commit
To go back to an earlier version: on the `flood.json` page click **History** → choose the correct version → **⋯ → View file** → **Raw** → copy everything → edit `flood.json`, replace the whole content with what you copied → commit.

---

## ฉุกเฉิน: ปิด service worker · Emergency: turn off the service worker

ใช้เฉพาะเมื่อผู้ดูแลขอ เช่น ผู้ใช้ยังเห็นหน้าเก่าค้างอยู่ทั้งที่แก้แล้ว
Only do this if the maintainer asks, e.g. people keep seeing an old version of the page after it has been fixed.

ใน `data/flood.json` เพิ่มบรรทัดนี้ใต้ `{` บรรทัดแรกสุด แล้ว commit ตามปกติ
In `data/flood.json`, add this line directly under the very first `{`, then commit as usual:
```json
  "serviceWorker": false,
```
เปิดใช้อีกครั้ง: ลบบรรทัดนี้ออก · To turn it back on: delete the line.
