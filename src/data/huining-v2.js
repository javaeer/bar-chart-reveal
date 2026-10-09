// 会宁县乡镇数据集（v2 数据模板 · 纯字面量，无 fs/DOM 依赖）
// 由 scripts/data/fetch-huining.mjs 生成；亦可手改后 npm run data 覆盖。
// 结构说明见 README「数据模板（v2 schema）」章节。
// 注意：本文件被 src/core/config.js 直接 import（config.js 是纯逻辑模块，不能读写文件），
//       故必须以 .js 字面量形式存在，而非 .json。
export const HUINING_V2 = {
  "schemaVersion": "1.0",
  "aspect": "16:9",
  "barIntervalMs": 2000,
  "dataset": {
    "id": "huining_townships",
    "name": "会宁县乡镇基础数据对比",
    "entityLabel": "乡镇",
    "source": "会宁县人民政府官网、区划地名网、百度百科",
    "updatedAt": "2026-10",
    "highlightEntityId": "huishi",
    "notes": [
      "人口以2018年末户籍人口为主，郭城驿镇为2020年数据",
      "海拔数据缺失较多，已标记 enabled=false，补录后可启用"
    ]
  },
  "entity": {
    "idField": "id",
    "nameField": "name",
    "groupField": "group",
    "groupValues": [
      "镇",
      "乡"
    ]
  },
  "metrics": [
    {
      "key": "population",
      "label": "人口",
      "unit": "人",
      "valueType": "integer",
      "decimals": 0,
      "scale": 1,
      "sortDefault": "asc",
      "defaultVisible": true,
      "enabled": true,
      "group": "规模",
      "caliber": "户籍人口",
      "year": 2018,
      "missingPolicy": "skip",
      "description": "各乡镇户籍人口，个别为2020年数据"
    },
    {
      "key": "area",
      "label": "面积",
      "unit": "km²",
      "valueType": "number",
      "decimals": 1,
      "scale": 1,
      "sortDefault": "asc",
      "defaultVisible": true,
      "enabled": true,
      "group": "规模",
      "caliber": "行政区域面积",
      "year": null,
      "missingPolicy": "skip",
      "description": "各乡镇行政区域面积"
    },
    {
      "key": "elevation",
      "label": "海拔",
      "unit": "m",
      "valueType": "integer",
      "decimals": 0,
      "scale": 1,
      "sortDefault": "asc",
      "defaultVisible": false,
      "enabled": false,
      "group": "地理",
      "caliber": "乡镇政府驻地海拔",
      "year": null,
      "missingPolicy": "disable",
      "description": "缺失较多乡镇，建议补录后启用"
    },
    {
      "key": "elevationRange",
      "label": "海拔落差",
      "unit": "m",
      "valueType": "integer",
      "decimals": 0,
      "scale": 1,
      "sortDefault": "desc",
      "defaultVisible": false,
      "enabled": false,
      "group": "地理",
      "caliber": "最高点-最低点",
      "year": null,
      "missingPolicy": "disable",
      "description": "缺失较多乡镇，建议补录后启用"
    },
    {
      "key": "redSiteCount",
      "label": "红色景点数",
      "unit": "个",
      "valueType": "integer",
      "decimals": 0,
      "scale": 1,
      "sortDefault": "desc",
      "defaultVisible": true,
      "enabled": true,
      "group": "红色资源",
      "caliber": "已列入名录的遗址遗迹数",
      "year": null,
      "missingPolicy": "zero",
      "description": "含旧址、战斗遗址、陵园、纪念场馆"
    }
  ],
  "entities": [
    {
      "id": "huishi",
      "name": "会师镇",
      "group": "镇",
      "metrics": {
        "population": 114130,
        "area": 203.6,
        "elevation": 1950,
        "elevationRange": null,
        "redSiteCount": 7
      },
      "extra": {
        "redSites": [
          "红军会宁会师旧址",
          "红军会师楼",
          "文庙大成殿",
          "会师纪念塔",
          "红军长征将帅碑林",
          "会宁红军会师革命文物陈列馆",
          "南什红军村"
        ]
      }
    },
    {
      "id": "guochengyi",
      "name": "郭城驿镇",
      "group": "镇",
      "metrics": {
        "population": 28040,
        "area": 329,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "红堡子红军战斗旧址"
        ]
      }
    },
    {
      "id": "hepan",
      "name": "河畔镇",
      "group": "镇",
      "metrics": {
        "population": 20240,
        "area": 243.4,
        "elevation": 1500,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "慢牛坡战斗遗址"
        ]
      }
    },
    {
      "id": "touzhaizi",
      "name": "头寨子镇",
      "group": "镇",
      "metrics": {
        "population": 16480,
        "area": 473.8,
        "elevation": 1700,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "gangouyi",
      "name": "甘沟驿镇",
      "group": "镇",
      "metrics": {
        "population": 11830,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "taipingdian",
      "name": "太平店镇",
      "group": "镇",
      "metrics": {
        "population": 11650,
        "area": 139.9,
        "elevation": 1865,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "zhaijiasuo",
      "name": "翟家所镇",
      "group": "镇",
      "metrics": {
        "population": 10180,
        "area": 181.9,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "张城堡红军战斗旧址"
        ]
      }
    },
    {
      "id": "laojunpo",
      "name": "老君坡镇",
      "group": "镇",
      "metrics": {
        "population": 11480,
        "area": 138.3,
        "elevation": 2073,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "zhongchuan",
      "name": "中川镇",
      "group": "镇",
      "metrics": {
        "population": 9410,
        "area": 138,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 2
      },
      "extra": {
        "redSites": [
          "大墩梁红军烈士陵园",
          "大墩梁红军战斗旧址"
        ]
      }
    },
    {
      "id": "hanjiacha",
      "name": "汉家岔镇",
      "group": "镇",
      "metrics": {
        "population": 9760,
        "area": 387.5,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "xinzhuang",
      "name": "新庄塬镇",
      "group": "镇",
      "metrics": {
        "population": 5400,
        "area": 332,
        "elevation": 2000,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "sifangwu",
      "name": "四房吴镇",
      "group": "镇",
      "metrics": {
        "population": 8560,
        "area": 258.8,
        "elevation": 1900,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "tumenxian",
      "name": "土门岘镇",
      "group": "镇",
      "metrics": {
        "population": 4340,
        "area": 185,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "pingtouchuan",
      "name": "平头川镇",
      "group": "镇",
      "metrics": {
        "population": 6490,
        "area": 138.27,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "xinyuan",
      "name": "新塬镇",
      "group": "镇",
      "metrics": {
        "population": 7210,
        "area": 287.3,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "houjiachuan",
      "name": "侯家川镇",
      "group": "镇",
      "metrics": {
        "population": 6760,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "chaijiamen",
      "name": "柴家门镇",
      "group": "镇",
      "metrics": {
        "population": 20900,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "会宁古城遗址"
        ]
      }
    },
    {
      "id": "liujiazhai",
      "name": "刘家寨子镇",
      "group": "镇",
      "metrics": {
        "population": 8600,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "baicaoyuan",
      "name": "白草塬镇",
      "group": "镇",
      "metrics": {
        "population": 13610,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "慢牛坡战斗遗址"
        ]
      }
    },
    {
      "id": "dagou",
      "name": "大沟镇",
      "group": "镇",
      "metrics": {
        "population": 10340,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "dingjiagou",
      "name": "丁家沟镇",
      "group": "镇",
      "metrics": {
        "population": 10520,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "会宁南川·红军村旅游景区（AAA级）"
        ]
      }
    },
    {
      "id": "yangyaji",
      "name": "杨崖集镇",
      "group": "镇",
      "metrics": {
        "population": 10930,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "hanjiaji",
      "name": "韩家集镇",
      "group": "镇",
      "metrics": {
        "population": 7050,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "tugaoshan",
      "name": "土高山乡",
      "group": "乡",
      "metrics": {
        "population": 4050,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "xintianpu",
      "name": "新添堡回族乡",
      "group": "乡",
      "metrics": {
        "population": 8590,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "dangjiaxian",
      "name": "党家岘乡",
      "group": "乡",
      "metrics": {
        "population": 10340,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 1
      },
      "extra": {
        "redSites": [
          "会宁县长征农场"
        ]
      }
    },
    {
      "id": "baligou",
      "name": "八里湾乡",
      "group": "乡",
      "metrics": {
        "population": 8230,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    },
    {
      "id": "caotan",
      "name": "草滩镇",
      "group": "镇",
      "metrics": {
        "population": 6470,
        "area": null,
        "elevation": null,
        "elevationRange": null,
        "redSiteCount": 0
      },
      "extra": {
        "redSites": []
      }
    }
  ],
  "theme": "tech",
  "defaultShape": "bar",
  "revealRatio": 0.72
};

export default HUINING_V2;
